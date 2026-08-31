/**
 * One-off: edit `cashCollected` on a SINGLE delivery entry of a CLOSED daily
 * sheet, keeping every denormalised copy of that number in sync.
 *
 * WHY a plain UPDATE is wrong: when a delivery is recorded (ledger.service.ts
 * recordDelivery) the collected cash lands in THREE places —
 *   1. DailySheetItem.cashCollected              (the sheet line)
 *   2. a Transaction row, type=PAYMENT, dailySheetItemId=<item>, amount=-cash,
 *      description "Cash collected during delivery"   (statement / portal / analytics)
 *   3. Customer.financialBalance, which was moved by (billAmount - cash)
 * Editing only #1 leaves #2 and #3 stale, so the customer's statement / portal
 * balance diverge by the delta. The app's own resync path (submitDelivery +
 * forceResubmit -> applyIdempotentRepost) needs an ACTIVE TRIP, which a closed
 * sheet has none of, so there is no UI route for this.
 *
 * WHAT this does (bottles unchanged, so the delta is purely financial and equals
 * oldCash - newCash): in one transaction it updates the item, patches / creates /
 * deletes the PAYMENT Transaction, and increments Customer.financialBalance by
 * (oldCash - newCash). It does NOT touch DailySheet.cashCollected / cashExpected
 * or any close-time reconciliation / payroll snapshot — those are historical.
 *
 * After a real run, clear the customer's Redis cache (keys printed at the end).
 *
 * Run:  DATABASE_URL=$DATABASE_URL node fix-cash-collected.mjs
 *   (DRY_RUN=true by default — prints the plan and exits; flip it to apply)
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({ datasources: { db: { url: process.env['DATABASE_URL'] } } });

// ─── EDIT THESE ───────────────────────────────────────────────────────────────
const SHEET_ID = '2f7e91e1-f720-4b91-8f4a-ef0c97e11f5a';
const CUSTOMER_CODE = 'L3442';   // customer whose entry you are fixing
const NEW_CASH = 5500;              // desired cashCollected, in Rs
const DRY_RUN = true;            // set false to actually write
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const item = await prisma.dailySheetItem.findFirst({
    where: { dailySheetId: SHEET_ID, customer: { customerCode: CUSTOMER_CODE } },
    include: {
      customer: { select: { id: true, name: true, financialBalance: true } },
      dailySheet: { select: { vendorId: true, isClosed: true, date: true } },
    },
  });
  if (!item) throw new Error(`No item for sheet ${SHEET_ID} + customer ${CUSTOMER_CODE}`);

  const oldCash = item.cashCollected;
  const delta = oldCash - NEW_CASH; // Customer.financialBalance += delta

  const payment = await prisma.transaction.findFirst({
    where: { dailySheetItemId: item.id, type: 'PAYMENT' },
  });

  console.log({
    itemId: item.id,
    customer: item.customer.name,
    sheetDate: item.dailySheet.date,
    isClosed: item.dailySheet.isClosed,
    oldCash,
    newCash: NEW_CASH,
    balanceBefore: item.customer.financialBalance,
    balanceAfter: item.customer.financialBalance + delta,
    paymentTx: payment ? payment.id : '(none — was 0)',
    vendorId: item.dailySheet.vendorId,
    customerId: item.customer.id,
  });

  if (DRY_RUN) {
    console.log('\nDRY_RUN — nothing written. Set DRY_RUN=false to apply.');
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.dailySheetItem.update({
      where: { id: item.id },
      data: { cashCollected: NEW_CASH, editCount: { increment: 1 }, lastEditedAt: new Date() },
    });

    if (NEW_CASH > 0 && payment) {
      await tx.transaction.update({ where: { id: payment.id }, data: { amount: -NEW_CASH } });
    } else if (NEW_CASH > 0 && !payment) {
      await tx.transaction.create({
        data: {
          type: 'PAYMENT',
          vendorId: item.dailySheet.vendorId,
          customerId: item.customer.id,
          dailySheetId: SHEET_ID,
          dailySheetItemId: item.id,
          amount: -NEW_CASH,
          createdAt: item.dailySheet.date, // keep it on the original business date
          description: 'Cash collected during delivery',
        },
      });
    } else if (NEW_CASH === 0 && payment) {
      await tx.transaction.delete({ where: { id: payment.id } });
    }

    if (delta !== 0) {
      await tx.customer.update({
        where: { id: item.customer.id },
        data: { financialBalance: { increment: delta } },
      });
    }
  });

  console.log('\nDONE. Clear Redis for this customer (redis-cli):');
  console.log(`  DEL vendor:${item.dailySheet.vendorId}:wallets:${item.customer.id}`);
  console.log(`  DEL vendor:${item.dailySheet.vendorId}:dashboard:overview`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
