/**
 * Diagnostic (read-only): prints one customer+product's full delivery history
 * so a wallet-going-negative case flagged by backfill-filled-return-credit.mjs's
 * dry run can be understood before deciding whether to apply the correction.
 *
 * Run: node check-customer-wallet-history.mjs <customerId> <productId>
 */
import { PrismaClient } from '@prisma/client';

const [customerId, productId] = process.argv.slice(2);
if (!customerId || !productId) {
  console.error('Usage: node check-customer-wallet-history.mjs <customerId> <productId>');
  process.exit(1);
}

const prisma = new PrismaClient({ datasources: { db: { url: process.env['DATABASE_URL'] } } });

async function main() {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { name: true, customerCode: true, isActive: true, financialBalance: true },
  });
  const wallet = await prisma.bottleWallet.findUnique({
    where: { customerId_productId: { customerId, productId } },
  });
  const product = await prisma.product.findUnique({ where: { id: productId }, select: { name: true } });

  console.log(`\nCustomer: ${customer?.name} (${customer?.customerCode}) — active=${customer?.isActive}`);
  console.log(`Product : ${product?.name}`);
  console.log(`Current live wallet balance: ${wallet?.balance}\n`);

  const items = await prisma.dailySheetItem.findMany({
    where: { customerId, productId, status: { in: ['COMPLETED', 'EMPTY_ONLY'] } },
    select: {
      id: true, status: true, deliveredAt: true, filledDropped: true, emptyReceived: true,
      filledReceived: true, bottleBalanceAfter: true, voidedAt: true, isCorrection: true,
      dailySheet: { select: { date: true } },
    },
    orderBy: [{ deliveredAt: 'asc' }, { id: 'asc' }],
  });

  console.log(`${items.length} completed/empty-only delivery item(s) for this customer+product:\n`);
  console.log('Date         Status       Drop  Emp  FillRet  BottleBalAfter  Voided  Correction  ItemId');
  for (const it of items) {
    const date = (it.deliveredAt ?? it.dailySheet.date).toISOString().slice(0, 10);
    console.log(
      `${date}   ${it.status.padEnd(11)}  ${String(it.filledDropped).padStart(4)}  ${String(it.emptyReceived).padStart(3)}  ${String(it.filledReceived).padStart(7)}  ${String(it.bottleBalanceAfter).padStart(14)}  ${it.voidedAt ? 'YES' : '-'.padEnd(6)}     ${it.isCorrection ? 'YES' : '-'}         ${it.id}`,
    );
  }

  // Also show any direct wallet-mutating ADJUSTMENT rows (damage waive / force
  // deactivate / manual adjustBottleWallet) that wouldn't show up above.
  const adjustments = await prisma.transaction.findMany({
    where: { customerId, productId, type: 'ADJUSTMENT' },
    select: { id: true, createdAt: true, bottleCount: true, description: true },
    orderBy: { createdAt: 'asc' },
  });
  if (adjustments.length > 0) {
    console.log(`\n${adjustments.length} ADJUSTMENT transaction(s) affecting this product's wallet:`);
    for (const a of adjustments) {
      console.log(`   ${a.createdAt.toISOString().slice(0, 10)}  bottleCount=${a.bottleCount}  ${a.description}`);
    }
  }

  console.log('\nDone.\n');
}

main().catch((e) => { console.error('Failed:', e); process.exit(1); }).finally(() => prisma.$disconnect());
