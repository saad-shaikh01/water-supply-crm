/**
 * Backfill Customer.createdAt for vendor BLUE ICE.
 *
 * The importer left createdAt at the import timestamp (now()), which made the
 * customer "join date" = June 2026. The statement month-picker and "All Time"
 * views key off createdAt, so historical months were disabled / hidden.
 *
 * This sets each customer's createdAt to the EARLIEST of:
 *   - their Opening_Date (from Master_Data_complete.html), if parseable
 *   - their earliest transaction date (from the DB)
 * so statements and history span the customer's real lifetime. Idempotent &
 * safe to re-run; touches ONLY Customer.createdAt.
 *
 * Run:  node backfill-customer-dates.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VENDOR_SLUG = 'blue-ice';
const prisma = new PrismaClient({ datasources: { db: { url: process.env['DATABASE_URL'] } } });

function dec(s){ return s.replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(+n)).replace(/&amp;/g,'&').replace(/&nbsp;/g,' '); }
function strip(s){ return dec(s.replace(/<[^>]*>/g,'').trim()); }

const MONTHS = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
// Parse "25-Jun-25" → Date(2025,5,25). Returns null if blank/unparseable.
function parseOpening(s){
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/.exec((s||'').trim());
  if (!m) return null;
  const day = +m[1]; const mon = MONTHS[m[2].toLowerCase()]; let yr = +m[3];
  if (mon === undefined) return null;
  if (yr < 100) yr += 2000;
  return new Date(Date.UTC(yr, mon, day));
}

function parseMasterOpening(){
  const raw = fs.readFileSync(path.join(__dirname, 'Master_Data_complete.html'), 'utf8');
  const headers = [...raw.matchAll(/<TH[^>]*>([\s\S]*?)<\/TH>/gi)].map(x=>strip(x[1]));
  const idx = Object.fromEntries(headers.map((h,i)=>[h,i]));
  const rows = raw.split(/<TBODY>/i)[1].split(/<TR VALIGN=TOP>/i).slice(1)
    .map(b=>[...b.matchAll(/<TD[^>]*>([\s\S]*?)<\/TD>/gi)].map(x=>strip(x[1])));
  const out = {};
  for (const r of rows){ const code=(r[idx.Cust_Code]||'').trim(); if(code) out[code]=parseOpening(r[idx.Opening_Date]); }
  return out;
}

async function main(){
  console.log('\n📅 BLUE ICE customer createdAt backfill\n');
  const opening = parseMasterOpening();
  const vendor = await prisma.vendor.findUnique({ where:{ slug:VENDOR_SLUG }, select:{ id:true } });
  if (!vendor) throw new Error(`Vendor '${VENDOR_SLUG}' not found`);

  // earliest transaction per customer
  const mins = await prisma.transaction.groupBy({ by:['customerId'], where:{ vendorId:vendor.id, customerId:{ not:null } }, _min:{ createdAt:true } });
  const earliestTxn = {};
  for (const g of mins) if (g.customerId) earliestTxn[g.customerId] = g._min.createdAt;

  const customers = await prisma.customer.findMany({ where:{ vendorId:vendor.id }, select:{ id:true, customerCode:true, createdAt:true } });
  let updated = 0, noChange = 0;
  for (const c of customers){
    const candidates = [];
    const op = opening[c.customerCode];
    if (op) candidates.push(op);
    if (earliestTxn[c.id]) candidates.push(earliestTxn[c.id]);
    if (!candidates.length) { noChange++; continue; }
    const target = new Date(Math.min(...candidates.map(d=>d.getTime())));
    // only update if meaningfully earlier than current createdAt
    if (target.getTime() < c.createdAt.getTime() - 86_400_000) {
      await prisma.customer.update({ where:{ id:c.id }, data:{ createdAt: target } });
      updated++;
    } else noChange++;
  }

  console.log('═══════════════════════════════════════════');
  console.log('  ✅ createdAt BACKFILL COMPLETE');
  console.log('───────────────────────────────────────────');
  console.log(`  Customers updated : ${updated}`);
  console.log(`  Unchanged         : ${noChange}`);
  // sample
  const sample = await prisma.customer.findMany({ where:{ vendorId:vendor.id }, take:3, select:{ customerCode:true, createdAt:true } });
  for (const s of sample) console.log(`    ${s.customerCode}: ${s.createdAt.toISOString().slice(0,10)}`);
  console.log('═══════════════════════════════════════════\n');
}

main().catch(e=>{ console.error('❌ Backfill failed:', e); process.exit(1); }).finally(()=>prisma.$disconnect());
