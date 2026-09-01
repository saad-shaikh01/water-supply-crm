/**
 * One-off: backdate the ledger rows of CORRECTION entries (missed deliveries
 * added to a closed sheet) to the sheet's own date.
 *
 * WHY: before the `occurredAt` fix, addCorrectionItem() posted the DELIVERY /
 * PAYMENT Transaction rows with createdAt = now (the day it was keyed in), not
 * the day the delivery happened. The monthly statement, the portal transaction
 * list and analytics all order/bucket by Transaction.createdAt, so a delivery
 * for the 17 Aug sheet keyed in on 30 Aug showed up as 30 Aug — and, if keyed
 * in the following month, landed in the wrong month's statement entirely.
 *
 * The code fix is forward-only. This script repairs the rows created before it.
 *
 * WHAT it does: for every Transaction whose dailySheetItem.isCorrection = true
 * and whose createdAt falls on a different calendar day than the sheet date, it
 * sets createdAt = dailySheet.date (exactly what the new code now writes via
 * occurredAt). Nothing else changes — amounts, balances, wallet counts and the
 * DailySheetItem.correctionAddedAt audit stamp are all left untouched, so this
 * is balance-neutral. updatedAt is intentionally not bumped.
 *
 * After a real run, clear the affected customers' Redis cache (keys printed).
 *
 * Run:  DATABASE_URL=$DATABASE_URL node backfill-correction-tx-dates.mjs
 *   (DRY_RUN=true by default — prints the plan and exits; set DRY_RUN=false to apply)
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({ datasources: { db: { url: process.env['DATABASE_URL'] } } });

const DRY_RUN = process.env['DRY_RUN'] !== 'false';

const sameDay = (a, b) =>
  a.getUTCFullYear() === b.getUTCFullYear() &&
  a.getUTCMonth() === b.getUTCMonth() &&
  a.getUTCDate() === b.getUTCDate();

async function main() {
  const rows = await prisma.transaction.findMany({
    where: { dailySheetItem: { isCorrection: true } },
    select: {
      id: true,
      type: true,
      amount: true,
      createdAt: true,
      vendorId: true,
      customerId: true,
      customer: { select: { customerCode: true, name: true } },
      dailySheetItem: {
        select: { id: true, dailySheet: { select: { id: true, date: true } } },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  const toFix = rows.filter((r) => {
    const sheetDate = r.dailySheetItem?.dailySheet?.date;
    return sheetDate && !sameDay(r.createdAt, sheetDate);
  });

  console.log(`Correction-linked transactions found : ${rows.length}`);
  console.log(`Needing a date fix                   : ${toFix.length}\n`);

  for (const r of toFix) {
    const sheetDate = r.dailySheetItem.dailySheet.date;
    console.log(
      `${r.id}  ${r.type.padEnd(8)}  ${String(r.amount ?? '').padStart(8)}  ` +
      `${r.createdAt.toISOString().slice(0, 10)} -> ${sheetDate.toISOString().slice(0, 10)}  ` +
      `${r.customer?.customerCode ?? '-'} ${r.customer?.name ?? ''}`,
    );
  }

  if (DRY_RUN) {
    console.log('\nDRY_RUN — nothing written. Re-run with DRY_RUN=false to apply.');
    return;
  }

  let done = 0;
  for (const r of toFix) {
    await prisma.transaction.update({
      where: { id: r.id },
      data: { createdAt: r.dailySheetItem.dailySheet.date },
    });
    done++;
  }
  console.log(`\nDONE. Updated ${done} transaction row(s).`);

  const vendors = [...new Set(toFix.map((r) => r.vendorId))];
  const customers = [...new Set(toFix.map((r) => `${r.vendorId}:${r.customerId}`))];
  console.log('\nClear Redis (redis-cli):');
  for (const v of vendors) {
    console.log(`  DEL vendor:${v}:dashboard:overview`);
  }
  for (const c of customers) {
    console.log(`  DEL vendor:${c.split(':')[0]}:wallets:${c.split(':')[1]}`);
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
