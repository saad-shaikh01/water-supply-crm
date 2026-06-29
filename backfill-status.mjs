/**
 * Fix Customer.isActive for vendor BLUE ICE.
 *
 * The importer originally read Cust_Status backwards (treated 1 as active).
 * Correct mapping: Cust_Status 0 = ACTIVE, 1 = CLOSED/inactive.
 * This re-reads Master_Data_complete.html and sets isActive accordingly.
 * Idempotent & safe to re-run; touches ONLY Customer.isActive.
 *
 * Run:  node backfill-status.mjs
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

function parseStatus(){
  const raw = fs.readFileSync(path.join(__dirname, 'Master_Data_complete.html'), 'utf8');
  const headers = [...raw.matchAll(/<TH[^>]*>([\s\S]*?)<\/TH>/gi)].map(x=>strip(x[1]));
  const idx = Object.fromEntries(headers.map((h,i)=>[h,i]));
  const rows = raw.split(/<TBODY>/i)[1].split(/<TR VALIGN=TOP>/i).slice(1)
    .map(b=>[...b.matchAll(/<TD[^>]*>([\s\S]*?)<\/TD>/gi)].map(x=>strip(x[1])));
  const out = {};
  for (const r of rows){ const code=(r[idx.Cust_Code]||'').trim(); if(code) out[code] = (r[idx.Cust_Status]||'').trim() === '0'; }
  return out; // code → isActive (true when Cust_Status === '0')
}

async function main(){
  console.log('\n🔁 BLUE ICE customer status fix (0=active, 1=closed)\n');
  const activeByCode = parseStatus();
  const vendor = await prisma.vendor.findUnique({ where:{ slug:VENDOR_SLUG }, select:{ id:true } });
  if (!vendor) throw new Error(`Vendor '${VENDOR_SLUG}' not found`);

  const customers = await prisma.customer.findMany({ where:{ vendorId:vendor.id }, select:{ id:true, customerCode:true, isActive:true } });
  const activeIds = [], inactiveIds = [];
  let unknown = 0;
  for (const c of customers){
    const shouldBeActive = activeByCode[c.customerCode];
    if (shouldBeActive === undefined) { unknown++; continue; }
    if (shouldBeActive) activeIds.push(c.id); else inactiveIds.push(c.id);
  }
  const batchUpdate = async (ids, val) => {
    for (let i=0;i<ids.length;i+=1000){
      await prisma.customer.updateMany({ where:{ id:{ in: ids.slice(i,i+1000) } }, data:{ isActive: val } });
    }
  };
  await batchUpdate(activeIds, true);
  await batchUpdate(inactiveIds, false);

  console.log('═══════════════════════════════════════════');
  console.log('  ✅ STATUS FIX COMPLETE');
  console.log('───────────────────────────────────────────');
  console.log(`  Active   (Cust_Status 0): ${activeIds.length}`);
  console.log(`  Inactive (Cust_Status 1): ${inactiveIds.length}`);
  if (unknown) console.log(`  Not in Master (unchanged): ${unknown}`);
  console.log('═══════════════════════════════════════════\n');
}

main().catch(e=>{ console.error('❌ Fix failed:', e); process.exit(1); }).finally(()=>prisma.$disconnect());
