/**
 * One-off resync: recompute a single closed sheet's NET cash-owed figure
 * (Σ non-voided item.cashCollected − expenses paid from cash − crew cash,
 * floored at 0 — the exact same formula as sheet-cash.util.ts's
 * buildReconciliation().driver.netToHandIn / resolveSheetCash().cashExpected)
 * and apply it to that sheet's Van Cash Ledger handover, using the same
 * branching VanCashLedgerService.handlePostCloseCorrection() uses:
 *
 *   - no handover row yet            → seed one PENDING (skipped if net is 0)
 *   - single row, still PENDING      → rewrite its amount in place
 *   - already APPROVED / a chain     → append a new APPROVED delta-correction row
 *
 * WHY THIS SCRIPT EXISTS: before the 2026-09-18 fix, correctClosedDelivery /
 * voidDelivery / addCorrectionItem never synced the Van Cash Ledger handover
 * after a post-close delivery edit (only Expense corrections did). Any sheet
 * corrected BEFORE that fix landed is stuck with a stale handover amount —
 * this script is the one-time catch-up for those specific sheets. New
 * corrections after the fix sync automatically; this script is not meant to
 * be run repeatedly / on a schedule.
 *
 * Run:  node fix-sheet-cash-ledger.mjs <dailySheetId>                (DRY RUN — default, no writes)
 *       node fix-sheet-cash-ledger.mjs <dailySheetId> --apply         (real run)
 */
import { PrismaClient } from '@prisma/client';

const APPLY = process.argv.includes('--apply');
const SHEET_ID = process.argv[2];

if (!SHEET_ID || SHEET_ID.startsWith('--')) {
  console.error('Usage: node fix-sheet-cash-ledger.mjs <dailySheetId> [--apply]');
  process.exit(1);
}

const prisma = new PrismaClient({ datasources: { db: { url: process.env['DATABASE_URL'] } } });

function round2(n) {
  return Math.round(n * 100) / 100;
}

async function main() {
  console.log(`\n🔄 Van Cash Ledger resync for sheet ${SHEET_ID} ${APPLY ? '' : '(DRY RUN)'}\n`);

  const sheet = await prisma.dailySheet.findUnique({
    where: { id: SHEET_ID },
    select: { id: true, vendorId: true, vanId: true, driverId: true, date: true, isClosed: true, cashCollected: true, cashExpected: true },
  });
  if (!sheet) {
    console.error('Sheet not found.');
    process.exit(1);
  }
  if (!sheet.isClosed) {
    console.error('Sheet is not closed — nothing to resync (handovers only exist for closed sheets).');
    process.exit(1);
  }

  const items = await prisma.dailySheetItem.findMany({
    where: { dailySheetId: SHEET_ID, status: { not: 'VOIDED' } },
    select: { cashCollected: true },
  });
  const shouldHandIn = items.reduce((s, i) => s + i.cashCollected, 0);

  const expenses = await prisma.expense.findMany({
    where: { dailySheetId: SHEET_ID },
    select: { amount: true, paidFromCash: true },
  });
  const totalExpenses = expenses
    .filter((e) => e.paidFromCash !== false)
    .reduce((s, e) => s + e.amount, 0);

  const crewCash = await prisma.crewCashDistribution.findMany({
    where: { dailySheetId: SHEET_ID },
    select: { amount: true },
  });
  const totalCrewCash = crewCash.reduce((s, c) => s + c.amount, 0);

  const newCashAmount = round2(Math.max(0, shouldHandIn - totalExpenses - totalCrewCash));

  console.log(`Frozen close-time cashCollected/cashExpected on the sheet: ${sheet.cashCollected} / ${sheet.cashExpected}`);
  console.log(`Live recompute — collected: ${shouldHandIn}, expenses(cash): ${totalExpenses}, crewCash: ${totalCrewCash}`);
  console.log(`→ Net amount owed to office (target handover total): ${newCashAmount}\n`);

  const chain = await prisma.vanCashHandover.findMany({
    where: { vendorId: sheet.vendorId, dailySheetId: SHEET_ID },
    orderBy: { createdAt: 'asc' },
  });

  console.log('Current VanCashHandover chain:');
  if (chain.length === 0) console.log('  (none)');
  for (const row of chain) {
    console.log(`  - id=${row.id} amount=${row.amount} status=${row.status} correctsEntryId=${row.correctsEntryId ?? '-'}`);
  }
  console.log();

  if (chain.length === 0) {
    if (newCashAmount === 0) {
      console.log('No handover exists and net amount is 0 — nothing to do.');
      return;
    }
    console.log(`PLAN: seed a new PENDING handover, amount=${newCashAmount}`);
    if (APPLY) {
      const seeded = await prisma.vanCashHandover.create({
        data: {
          vendorId: sheet.vendorId,
          vanId: sheet.vanId,
          dailySheetId: SHEET_ID,
          amount: newCashAmount,
          submittedById: sheet.driverId,
          date: sheet.date,
          status: 'PENDING',
        },
      });
      console.log(`✅ Seeded handover ${seeded.id}`);
    }
    return;
  }

  const currentTotal = round2(chain.reduce((s, r) => s + r.amount, 0));
  const delta = round2(newCashAmount - currentTotal);
  console.log(`Current chain total: ${currentTotal}. Delta needed: ${delta}`);

  if (delta === 0) {
    console.log('Already in sync — nothing to do.');
    return;
  }

  const original = chain.find((r) => r.correctsEntryId === null) ?? chain[0];
  const mostRecent = chain[chain.length - 1];

  if (original.status === 'PENDING' && chain.length === 1) {
    console.log(`PLAN: rewrite PENDING handover ${original.id}.amount ${original.amount} → ${newCashAmount} (in place)`);
    if (APPLY) {
      const updated = await prisma.vanCashHandover.update({
        where: { id: original.id },
        data: { amount: newCashAmount, version: { increment: 1 } },
      });
      console.log(`✅ Updated handover ${updated.id}, amount is now ${updated.amount}`);
    }
    return;
  }

  console.log(`PLAN: original/most-recent row is already ${original.status} — append a new APPROVED correction row, delta=${delta}, correctsEntryId=${mostRecent.id}`);
  if (APPLY) {
    const correction = await prisma.vanCashHandover.create({
      data: {
        vendorId: sheet.vendorId,
        vanId: mostRecent.vanId,
        dailySheetId: SHEET_ID,
        amount: delta,
        submittedById: mostRecent.submittedById,
        date: mostRecent.date,
        status: 'APPROVED',
        approvedAt: new Date(),
        correctsEntryId: mostRecent.id,
      },
    });
    console.log(`✅ Added correction row ${correction.id}, amount=${correction.amount}`);
  }

  if (!APPLY) console.log('\nDRY RUN complete — no DB writes. Re-run with --apply to write this change.\n');
}

main().catch((e) => { console.error('❌ Failed:', e); process.exit(1); }).finally(() => prisma.$disconnect());
