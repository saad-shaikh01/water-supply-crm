/**
 * Backfill missing BottleWallet rows for vendor BLUE ICE.
 *
 * The importer only created a wallet when the customer's Bottle_Balance was
 * non-zero, so ~713 customers have no wallet for the product. The customer
 * consumption tab's per-product breakdown (Deliveries / Avg / Bottles-Day /
 * Rate) is built from customer.wallets, so those customers show an empty
 * "No deliveries in this period" table even though they have delivery history.
 *
 * This creates a 0-balance wallet for every customer that is missing one, so
 * the per-product consumption breakdown renders for everyone. Idempotent &
 * safe to re-run; touches ONLY BottleWallet.
 *
 * Run:  node backfill-wallets.mjs
 */
import { PrismaClient } from '@prisma/client';

const VENDOR_SLUG = 'blue-ice';
const prisma = new PrismaClient({ datasources: { db: { url: process.env['DATABASE_URL'] } } });

async function main(){
  console.log('\n🪣 BLUE ICE bottle-wallet backfill\n');
  const vendor = await prisma.vendor.findUnique({ where:{ slug:VENDOR_SLUG }, select:{ id:true } });
  if (!vendor) throw new Error(`Vendor '${VENDOR_SLUG}' not found`);

  const products = await prisma.product.findMany({ where:{ vendorId:vendor.id }, select:{ id:true, name:true } });
  if (products.length !== 1) console.log(`  (note: ${products.length} products — creating wallets for the first: ${products[0]?.name})`);
  const product = products[0];
  if (!product) throw new Error('No product found for vendor');

  const customers = await prisma.customer.findMany({ where:{ vendorId:vendor.id }, select:{ id:true } });
  const existing = new Set((await prisma.bottleWallet.findMany({
    where:{ customer:{ vendorId:vendor.id }, productId:product.id }, select:{ customerId:true },
  })).map(w=>w.customerId));

  const toCreate = customers.filter(c=>!existing.has(c.id)).map(c=>({ customerId:c.id, productId:product.id, balance:0 }));
  for (let i=0;i<toCreate.length;i+=1000){
    await prisma.bottleWallet.createMany({ data: toCreate.slice(i,i+1000), skipDuplicates:true });
  }

  const totalWallets = await prisma.bottleWallet.count({ where:{ customer:{ vendorId:vendor.id }, productId:product.id } });
  console.log('═══════════════════════════════════════════');
  console.log('  ✅ WALLET BACKFILL COMPLETE');
  console.log('───────────────────────────────────────────');
  console.log(`  Product           : ${product.name}`);
  console.log(`  Customers         : ${customers.length}`);
  console.log(`  Wallets created   : ${toCreate.length} (0-balance)`);
  console.log(`  Total wallets now : ${totalWallets}`);
  console.log('═══════════════════════════════════════════\n');
}

main().catch(e=>{ console.error('❌ Backfill failed:', e); process.exit(1); }).finally(()=>prisma.$disconnect());
