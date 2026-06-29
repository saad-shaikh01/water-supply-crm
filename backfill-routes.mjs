/**
 * Idempotent backfill: create one Route per distinct `Area` for vendor BLUE ICE
 * and set each customer's `routeId` to their Area's route.
 *
 * Route NAME = the Area value verbatim (from Master_Data_complete.html), e.g.
 * "Gulshan", "Johar", "DHA". Each route's defaultVan = the dominant primary-van
 * among that area's customers (so the Van/Driver column populates).
 * Customers with a blank Area are left with routeId = null.
 *
 * Safe to re-run: nulls existing blue-ice routeIds, deletes blue-ice routes,
 * then recreates. Touches ONLY Route + Customer.routeId — no other data.
 *
 * Run:  node backfill-routes.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VENDOR_SLUG = 'blue-ice';
const prisma = new PrismaClient({ datasources: { db: { url: process.env['DATABASE_URL'] } } });

function dec(s) { return s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&').replace(/&nbsp;/g, ' '); }
function strip(s) { return dec(s.replace(/<[^>]*>/g, '').trim()); }

// Parse Master → { code: { area, primaryVanCode } }
function parseMaster() {
  const raw = fs.readFileSync(path.join(__dirname, 'Master_Data_complete.html'), 'utf8');
  const headers = [...raw.matchAll(/<TH[^>]*>([\s\S]*?)<\/TH>/gi)].map((x) => strip(x[1]));
  const idx = Object.fromEntries(headers.map((h, i) => [h, i]));
  const body = raw.split(/<TBODY>/i)[1];
  const rows = body.split(/<TR VALIGN=TOP>/i).slice(1)
    .map((b) => [...b.matchAll(/<TD[^>]*>([\s\S]*?)<\/TD>/gi)].map((x) => strip(x[1])));
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const out = {};
  for (const r of rows) {
    const code = (r[idx.Cust_Code] ?? '').trim();
    if (!code) continue;
    let primary = null;
    for (const d of days) { const v = (r[idx[d]] ?? '').trim(); if (v && v !== '0') { primary = v; break; } }
    out[code] = { area: (r[idx.Area] ?? '').trim(), primaryVanCode: primary };
  }
  return out;
}

async function main() {
  console.log('\n🛣️  BLUE ICE route backfill\n');
  const master = parseMaster();

  const vendor = await prisma.vendor.findUnique({ where: { slug: VENDOR_SLUG }, select: { id: true } });
  if (!vendor) throw new Error(`Vendor '${VENDOR_SLUG}' not found`);

  const vans = await prisma.van.findMany({ where: { vendorId: vendor.id }, select: { id: true, plateNumber: true } });
  const vanByCode = Object.fromEntries(vans.map((v) => [v.plateNumber, v]));

  // Each distinct (non-blank) Area = one Route. defaultVan = the dominant
  // primary-van among that area's customers (so the Van/Driver column populates).
  const areaVanCount = {}; // area → { vanCode → n }
  for (const { area, primaryVanCode } of Object.values(master)) {
    if (!area) continue;
    (areaVanCount[area] ??= {});
    if (primaryVanCode) areaVanCount[area][primaryVanCode] = (areaVanCount[area][primaryVanCode] || 0) + 1;
  }
  const dominantVanId = (area) => {
    const top = Object.entries(areaVanCount[area] || {}).sort((a, b) => b[1] - a[1])[0];
    return top ? vanByCode[top[0]]?.id ?? null : null;
  };

  // ── Reset (idempotent) ──
  await prisma.customer.updateMany({ where: { vendorId: vendor.id }, data: { routeId: null } });
  await prisma.route.deleteMany({ where: { vendorId: vendor.id } });

  // ── Create one route per Area (name = area) ──
  const areas = Object.keys(areaVanCount).sort();
  const routeByArea = {};
  for (const area of areas) {
    const route = await prisma.route.create({
      data: { name: area, vendorId: vendor.id, defaultVanId: dominantVanId(area) },
    });
    routeByArea[area] = route.id;
  }

  // ── Blank-area customers → grouped by their van. Create "Route <van>" for
  //    each van code that any blank-area customer uses. ──
  const blankVanCodes = new Set();
  for (const { area, primaryVanCode } of Object.values(master)) {
    if (!area && primaryVanCode) blankVanCodes.add(primaryVanCode);
  }
  const routeByVanCode = {};
  for (const code of [...blankVanCodes].sort()) {
    const route = await prisma.route.create({
      data: { name: `Route ${code}`, vendorId: vendor.id, defaultVanId: vanByCode[code]?.id ?? null },
    });
    routeByVanCode[code] = route.id;
  }
  console.log(`Created ${areas.length} area routes + ${blankVanCodes.size} van routes (for blank-area customers)`);

  // ── Assign customers: area → area route; blank area → their van route ──
  const customers = await prisma.customer.findMany({ where: { vendorId: vendor.id }, select: { id: true, customerCode: true } });
  const idsByRoute = {}; // routeId → [customerId]
  let noRoute = 0;
  for (const c of customers) {
    const info = master[c.customerCode];
    let routeId = null;
    if (info?.area) routeId = routeByArea[info.area];
    else if (info?.primaryVanCode) routeId = routeByVanCode[info.primaryVanCode];
    if (!routeId) { noRoute++; continue; }
    (idsByRoute[routeId] ??= []).push(c.id);
  }
  for (const [routeId, ids] of Object.entries(idsByRoute)) {
    for (let i = 0; i < ids.length; i += 1000) {
      await prisma.customer.updateMany({ where: { id: { in: ids.slice(i, i + 1000) } }, data: { routeId } });
    }
  }

  // ── Report ──
  const blankAssigned = [...blankVanCodes].reduce((s, code) => s + (idsByRoute[routeByVanCode[code]] || []).length, 0);
  console.log('\n═══════════════════════════════════════════');
  console.log('  ✅ ROUTE BACKFILL COMPLETE');
  console.log('───────────────────────────────────────────');
  console.log(`  Area routes    : ${areas.length}`);
  console.log(`  Van routes     : ${blankVanCodes.size} (blank-area fallback)`);
  const sorted = areas.map((a) => [a, (idsByRoute[routeByArea[a]] || []).length]).sort((x, y) => y[1] - x[1]);
  for (const [a, n] of sorted.slice(0, 10)) console.log(`    ${a}: ${n}`);
  if (sorted.length > 10) console.log(`    … +${sorted.length - 10} more areas`);
  for (const code of [...blankVanCodes].sort()) console.log(`    Route ${code}: ${(idsByRoute[routeByVanCode[code]] || []).length} (blank-area)`);
  console.log(`  Blank-area customers routed by van: ${blankAssigned}`);
  console.log(`  Customers left with NO route: ${noRoute}`);
  console.log('═══════════════════════════════════════════\n');
}

main().catch((e) => { console.error('❌ Backfill failed:', e); process.exit(1); }).finally(() => prisma.$disconnect());
