/**
 * Idempotent backfill: create one Route per Van for vendor BLUE ICE and set
 * each customer's `routeId` to their primary van's route.
 *
 * Route NAME = the dominant `Area` (from Master_Data_complete.html) among the
 * customers whose primary van is that van, suffixed with the van code for
 * uniqueness (e.g. "Safoora (V1)"). Falls back to "Route <code>" if no area.
 *
 * Primary van = the van of the customer's earliest scheduled weekday
 * (derived from CustomerDeliverySchedule in the DB — the source of truth).
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
  const codeByVanId = Object.fromEntries(vans.map((v) => [v.id, v.plateNumber]));
  console.log('Vans:', vans.map((v) => v.plateNumber).join(', '));

  // Dominant area per van code (from Master, keyed by primary van)
  const areaCount = {}; // vanCode → { area → n }
  for (const { area, primaryVanCode } of Object.values(master)) {
    if (!primaryVanCode) continue;
    (areaCount[primaryVanCode] ??= {});
    if (area) areaCount[primaryVanCode][area] = (areaCount[primaryVanCode][area] || 0) + 1;
  }
  const dominantArea = (code) => {
    const m = areaCount[code] || {};
    const top = Object.entries(m).sort((a, b) => b[1] - a[1])[0];
    return top ? top[0] : null;
  };

  // ── Reset (idempotent) ──
  await prisma.customer.updateMany({ where: { vendorId: vendor.id }, data: { routeId: null } });
  await prisma.route.deleteMany({ where: { vendorId: vendor.id } });

  // ── Create one route per van ──
  const routeByVanCode = {};
  for (const v of vans) {
    const area = dominantArea(v.plateNumber);
    const name = area ? `${area} (${v.plateNumber})` : `Route ${v.plateNumber}`;
    const route = await prisma.route.create({
      data: { name, vendorId: vendor.id, defaultVanId: v.id },
    });
    routeByVanCode[v.plateNumber] = route.id;
    console.log(`  Route created: "${name}" → van ${v.plateNumber}`);
  }

  // ── Assign customers by primary van (lowest dayOfWeek in DB schedule) ──
  const customers = await prisma.customer.findMany({
    where: { vendorId: vendor.id },
    select: { id: true, deliverySchedules: { select: { vanId: true, dayOfWeek: true } } },
  });
  const idsByRoute = {}; // routeId → [customerId]
  let noSchedule = 0;
  for (const c of customers) {
    if (!c.deliverySchedules.length) { noSchedule++; continue; }
    const primary = [...c.deliverySchedules].sort((a, b) => a.dayOfWeek - b.dayOfWeek)[0];
    const vanCode = codeByVanId[primary.vanId];
    const routeId = routeByVanCode[vanCode];
    if (!routeId) continue;
    (idsByRoute[routeId] ??= []).push(c.id);
  }
  for (const [routeId, ids] of Object.entries(idsByRoute)) {
    for (let i = 0; i < ids.length; i += 1000) {
      await prisma.customer.updateMany({ where: { id: { in: ids.slice(i, i + 1000) } }, data: { routeId } });
    }
  }

  // ── Report ──
  console.log('\n═══════════════════════════════════════════');
  console.log('  ✅ ROUTE BACKFILL COMPLETE');
  console.log('───────────────────────────────────────────');
  for (const v of vans) {
    const routeId = routeByVanCode[v.plateNumber];
    const n = (idsByRoute[routeId] || []).length;
    console.log(`  ${v.plateNumber}: ${n} customers`);
  }
  console.log(`  No schedule (routeId left null): ${noSchedule}`);
  console.log('═══════════════════════════════════════════\n');
}

main().catch((e) => { console.error('❌ Backfill failed:', e); process.exit(1); }).finally(() => prisma.$disconnect());
