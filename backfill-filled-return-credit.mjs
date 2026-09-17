/**
 * One-time backfill for the "Filled Return" ledger bug.
 *
 * WHY: DailySheetService.submitDelivery() — the normal "Record Delivery" flow used
 * on the daily-sheets page — called ledger.recordDelivery() without ever passing
 * `filledReceived` (already-filled bottles the driver takes back from a customer,
 * e.g. account closing / excess stock return). The DailySheetItem itself stored the
 * count correctly (it shows up in the UI), but the ledger never saw it, so for every
 * affected delivery:
 *   - the customer's BottleWallet balance was never decremented for those bottles
 *   - the customer was never credited (filledReceived × price) for bottles they'd
 *     already been charged for when originally delivered
 *   - the DELIVERY Transaction row was posted with filledReceived=0 and a charge
 *     amount that didn't net out the credit
 * (addCorrectionItem / addAdhocItem / recordWalkInDelivery already passed
 * filledReceived correctly — this only ever affected the submitDelivery path.)
 *
 * The code fix (already applied — see daily-sheet.service.ts submitDelivery +
 * ledger.service.ts recordDelivery) only prevents this for NEW deliveries. This
 * script retroactively corrects every existing affected row.
 *
 * DETECTION: a DailySheetItem is "affected" iff filledReceived > 0, status is
 * COMPLETED/EMPTY_ONLY, not voided, AND its linked DELIVERY Transaction has
 * filledReceived = 0 (the exact signature this bug leaves — any item recorded
 * through a code path that already passed filledReceived correctly, or already
 * fixed, will NOT match, making this script naturally idempotent/safe to re-run).
 *
 * WHAT IT DOES per affected item (missedCredit = filledReceived × pricePerBottle):
 *   1. Fixes the DELIVERY Transaction row itself: filledReceived, amount (net down
 *      by missedCredit), bottleCount (net down by filledReceived), description.
 *      Pure record correction — moves no balance by itself.
 *   2. Cascades the correction forward through every LATER DailySheetItem snapshot
 *      for that customer (financialBalanceAfter) / that customer+product
 *      (bottleBalanceAfter) so historical "Last 6 Deliveries" figures stay
 *      internally consistent — matched by item id in chronological order, not by
 *      re-deriving from scratch (bottleBalanceAfter is deliberately NOT fully
 *      replayed — a separate, unrelated DamageCase.waive() gap makes a full
 *      replay unsafe; this only propagates the exact, known delta this bug caused).
 *   3. Applies the net total credit/bottle-count to the customer:
 *      - Still-ACTIVE customer (or inactive but never Force-Deactivate written
 *        off): decrements Customer.financialBalance / BottleWallet.balance
 *        directly, with NO floor at zero — a customer who already owes nothing
 *        is pushed into a negative (credit) balance on purpose, because that's
 *        the true corrected figure.
 *      - Customer who was Force-Deactivated with this exact balance/wallet
 *        written off as a "company loss" (customer.service.ts `deactivate()`,
 *        surfaced in analytics.service.ts's Company Losses report as Transaction
 *        rows: type=ADJUSTMENT, description starting "Bad-debt write-off" /
 *        "Bottle write-off"): the recorded loss itself is restated DOWN by the
 *        missed amount instead — the account is closed, so the live balance/
 *        wallet (already zeroed by the write-off) is left at 0 rather than
 *        turned into a dangling credit on a closed account. If the missed
 *        amount exceeds what was originally written off, the correction is
 *        clamped at zero and reported for manual review (the company may
 *        additionally owe that customer beyond just cancelling the loss).
 *
 * Run:  node backfill-filled-return-credit.mjs                 (DRY RUN — default, no writes)
 *       node backfill-filled-return-credit.mjs --apply          (real run, all vendors)
 *       node backfill-filled-return-credit.mjs --apply --vendor=blue-ice   (scope to one vendor slug)
 *
 * Unlike this repo's other backfill-*.mjs scripts, this one defaults to DRY RUN —
 * explicit --apply is required to write. It moves real money (financialBalance)
 * and physical bottle counts across potentially many customers; review the dry-run
 * report first.
 */
import { PrismaClient } from '@prisma/client';

const APPLY = process.argv.includes('--apply');
const vendorArg = process.argv.find((a) => a.startsWith('--vendor='));
const VENDOR_SLUG = vendorArg ? vendorArg.split('=')[1] : null;

const prisma = new PrismaClient({ datasources: { db: { url: process.env['DATABASE_URL'] } } });

async function findAffectedItems() {
  const where = {
    filledReceived: { gt: 0 },
    status: { in: ['COMPLETED', 'EMPTY_ONLY'] },
    voidedAt: null,
    dailySheet: VENDOR_SLUG ? { vendor: { slug: VENDOR_SLUG } } : undefined,
  };

  const items = await prisma.dailySheetItem.findMany({
    where,
    select: {
      id: true,
      customerId: true,
      productId: true,
      filledReceived: true,
      pricePerBottle: true,
      deliveredAt: true,
      customer: { select: { name: true, customerCode: true, isActive: true } },
    },
    orderBy: [{ deliveredAt: 'asc' }, { id: 'asc' }],
  });
  if (items.length === 0) return [];

  const txns = await prisma.transaction.findMany({
    where: { dailySheetItemId: { in: items.map((i) => i.id) }, type: 'DELIVERY' },
    select: { id: true, dailySheetItemId: true, filledReceived: true, amount: true, bottleCount: true },
  });
  const txnByItem = new Map(txns.map((t) => [t.dailySheetItemId, t]));

  const affected = [];
  for (const item of items) {
    const txn = txnByItem.get(item.id);
    if (!txn) {
      console.warn(`   ⚠ item ${item.id} (filledReceived=${item.filledReceived}) has no DELIVERY transaction — skipped`);
      continue;
    }
    // Bug signature: transaction never saw filledReceived. Already-fixed rows
    // (or rows from code paths that never had the bug) have txn.filledReceived
    // === item.filledReceived and are correctly excluded here.
    if ((txn.filledReceived ?? 0) > 0) continue;

    const missedCredit = item.filledReceived * item.pricePerBottle;
    affected.push({ ...item, txn, missedCredit });
  }
  return affected;
}

// Cascades `deltaField` (financialBalanceAfter on DailySheetItem, keyed by customer;
// or bottleBalanceAfter, keyed by customer+product) forward through every later item
// so historical snapshots stay internally consistent with the corrected running total.
async function buildCascadeUpdates(groupKeyFn, valueFn, snapshotField, affectedItems) {
  const groups = new Map(); // groupKey -> [{ itemId, delta }]
  for (const it of affectedItems) {
    const key = groupKeyFn(it);
    const list = groups.get(key) ?? [];
    list.push({ itemId: it.id, delta: valueFn(it) });
    groups.set(key, list);
  }

  const snapshotUpdates = []; // { id, [snapshotField]: newValue }
  const groupTotals = new Map(); // groupKey -> total delta to apply to the live balance

  for (const [key, deltas] of groups) {
    const deltaByItemId = new Map(deltas.map((d) => [d.itemId, d.delta]));
    const [customerId, productId] = key.split('::');
    const where = { customerId, [snapshotField]: { not: null } };
    if (productId !== '_') where.productId = productId;

    const allItems = await prisma.dailySheetItem.findMany({
      where,
      select: { id: true, [snapshotField]: true, deliveredAt: true },
      orderBy: [{ deliveredAt: 'asc' }, { id: 'asc' }],
    });

    let offset = 0;
    for (const it of allItems) {
      if (deltaByItemId.has(it.id)) offset += deltaByItemId.get(it.id);
      if (offset !== 0) {
        snapshotUpdates.push({ id: it.id, [snapshotField]: it[snapshotField] - offset });
      }
    }
    groupTotals.set(key, offset);
  }

  return { snapshotUpdates, groupTotals };
}

// Decides where a customer's/product's net correction should land: the live
// balance (normal case), or a matching Force-Deactivate write-off Transaction
// (account closed, this exact balance/wallet already recorded as a company
// loss — restate that record down instead of crediting a closed account).
async function planFinancialCorrection(customerId, offset, isActive) {
  if (isActive !== false) return { target: 'live', customerId, offset };

  const writeOff = await prisma.transaction.findFirst({
    where: { customerId, type: 'ADJUSTMENT', description: { startsWith: 'Bad-debt write-off' } },
    orderBy: { createdAt: 'desc' },
  });
  if (!writeOff) return { target: 'live', customerId, offset };

  const applied = Math.min(offset, Math.abs(writeOff.amount ?? 0));
  return {
    target: 'writeoff', customerId, offset, applied, clamped: applied < offset,
    writeOffId: writeOff.id, writeOffAmount: writeOff.amount ?? 0,
  };
}

async function planBottleCorrection(customerId, productId, offset, isActive) {
  if (isActive !== false) return { target: 'live', customerId, productId, offset };

  const writeOff = await prisma.transaction.findFirst({
    where: { customerId, productId, type: 'ADJUSTMENT', description: { startsWith: 'Bottle write-off' } },
    orderBy: { createdAt: 'desc' },
  });
  if (!writeOff) return { target: 'live', customerId, productId, offset };

  const applied = Math.min(offset, Math.abs(writeOff.bottleCount ?? 0));
  return {
    target: 'writeoff', customerId, productId, offset, applied, clamped: applied < offset,
    writeOffId: writeOff.id, writeOffBottleCount: writeOff.bottleCount ?? 0,
  };
}

async function main() {
  console.log(`\n🔄 Filled Return credit backfill ${APPLY ? '' : '(DRY RUN)'}${VENDOR_SLUG ? ` — vendor '${VENDOR_SLUG}'` : ' — ALL vendors'}\n`);

  const affected = await findAffectedItems();
  if (affected.length === 0) {
    console.log('No affected deliveries found. Nothing to do.\n');
    return;
  }

  const totalMissedCredit = affected.reduce((s, i) => s + i.missedCredit, 0);
  const totalMissedBottles = affected.reduce((s, i) => s + i.filledReceived, 0);
  const customerIds = new Set(affected.map((i) => i.customerId));
  const inactiveCustomers = new Set(affected.filter((i) => !i.customer.isActive).map((i) => i.customerId));
  const activeById = new Map(affected.map((i) => [i.customerId, i.customer.isActive]));

  console.log(`Affected deliveries        : ${affected.length}`);
  console.log(`Customers affected         : ${customerIds.size} (${inactiveCustomers.size} inactive)`);
  console.log(`Total credit involved      : ₨${totalMissedCredit.toLocaleString()}`);
  console.log(`Total bottles involved     : ${totalMissedBottles}`);
  console.log();

  // ── Cascade financialBalanceAfter forward, per customer ──
  const { snapshotUpdates: financialSnapshotUpdates, groupTotals: financialTotals } =
    await buildCascadeUpdates(
      (it) => `${it.customerId}::_`,
      (it) => it.missedCredit,
      'financialBalanceAfter',
      affected,
    );

  // ── Cascade bottleBalanceAfter forward, per customer+product ──
  const { snapshotUpdates: bottleSnapshotUpdates, groupTotals: bottleTotals } =
    await buildCascadeUpdates(
      (it) => `${it.customerId}::${it.productId}`,
      (it) => it.filledReceived,
      'bottleBalanceAfter',
      affected,
    );

  // ── Decide, per customer/product, whether the net correction lands on the
  // live balance or on a Force-Deactivate write-off record ──
  const financialPlans = [];
  for (const [key, offset] of financialTotals) {
    if (offset === 0) continue;
    const [customerId] = key.split('::');
    financialPlans.push(await planFinancialCorrection(customerId, offset, activeById.get(customerId)));
  }
  const bottlePlans = [];
  for (const [key, offset] of bottleTotals) {
    if (offset === 0) continue;
    const [customerId, productId] = key.split('::');
    bottlePlans.push(await planBottleCorrection(customerId, productId, offset, activeById.get(customerId)));
  }

  const liveBalanceCount = financialPlans.filter((p) => p.target === 'live').length;
  const writeOffBalanceCount = financialPlans.filter((p) => p.target === 'writeoff').length;
  const liveWalletCount = bottlePlans.filter((p) => p.target === 'live').length;
  const writeOffWalletCount = bottlePlans.filter((p) => p.target === 'writeoff').length;

  console.log(`Balance corrections — live customer balance: ${liveBalanceCount}, restated write-off record: ${writeOffBalanceCount}`);
  console.log(`Wallet corrections  — live bottle wallet:    ${liveWalletCount}, restated write-off record: ${writeOffWalletCount}`);

  const clamped = [...financialPlans, ...bottlePlans].filter((p) => p.clamped);
  if (clamped.length > 0) {
    console.log(`\n⚠ ${clamped.length} write-off correction(s) CLAMPED — the missed amount exceeds what was originally written off.`);
    console.log(`  This means the company may owe these customers MORE than just cancelling the recorded loss — review manually:`);
    for (const c of clamped) {
      console.log(`   customer ${c.customerId}${c.productId ? ` / product ${c.productId}` : ''}: missed=${c.offset}, only ${c.applied} could be absorbed by the write-off`);
    }
  }

  const negativeLiveWallets = [];
  for (const p of bottlePlans.filter((p) => p.target === 'live')) {
    const wallet = await prisma.bottleWallet.findUnique({ where: { customerId_productId: { customerId: p.customerId, productId: p.productId } } });
    if (wallet && wallet.balance - p.offset < 0) {
      negativeLiveWallets.push({ customerId: p.customerId, productId: p.productId, current: wallet.balance, after: wallet.balance - p.offset });
    }
  }
  if (negativeLiveWallets.length > 0) {
    console.log(`\n⚠ ${negativeLiveWallets.length} live wallet(s) will go NEGATIVE after correction (applied anyway — that's the true corrected figure; review these):`);
    for (const w of negativeLiveWallets.slice(0, 30)) {
      console.log(`   customer ${w.customerId} / product ${w.productId}: ${w.current} → ${w.after}`);
    }
  }

  if (!APPLY) {
    console.log('\nDRY RUN complete — no DB writes. Re-run with --apply to write these changes.\n');
    return;
  }

  console.log('\n--- Writing updates ---');

  // 1. Fix the DELIVERY transaction rows themselves — pure record correction.
  for (const it of affected) {
    await prisma.transaction.update({
      where: { id: it.txn.id },
      data: {
        filledReceived: it.filledReceived,
        amount: it.txn.amount - it.missedCredit,
        bottleCount: it.txn.bottleCount - it.filledReceived,
        description: `Filled Received ${it.filledReceived} (backfilled credit ₨${it.missedCredit})`,
      },
    });
  }
  console.log(`   fixed ${affected.length} DELIVERY transaction row(s)`);

  // 2. Cascade snapshot corrections (historical accuracy only — moves no live balance).
  const BATCH = 500;
  for (let i = 0; i < financialSnapshotUpdates.length; i += BATCH) {
    const chunk = financialSnapshotUpdates.slice(i, i + BATCH);
    await prisma.$transaction(chunk.map((u) => prisma.dailySheetItem.update({ where: { id: u.id }, data: { financialBalanceAfter: u.financialBalanceAfter } })));
  }
  console.log(`   updated ${financialSnapshotUpdates.length} financialBalanceAfter snapshot(s)`);

  for (let i = 0; i < bottleSnapshotUpdates.length; i += BATCH) {
    const chunk = bottleSnapshotUpdates.slice(i, i + BATCH);
    await prisma.$transaction(chunk.map((u) => prisma.dailySheetItem.update({ where: { id: u.id }, data: { bottleBalanceAfter: u.bottleBalanceAfter } })));
  }
  console.log(`   updated ${bottleSnapshotUpdates.length} bottleBalanceAfter snapshot(s)`);

  // 3. Apply the net totals — live balance, or the write-off record, per plan above.
  for (const p of financialPlans) {
    if (p.target === 'writeoff') {
      await prisma.transaction.update({
        where: { id: p.writeOffId },
        data: { amount: Math.min(0, p.writeOffAmount + p.offset) },
      });
    } else {
      await prisma.customer.update({ where: { id: p.customerId }, data: { financialBalance: { decrement: p.offset } } });
    }
  }
  console.log(`   applied ${financialPlans.length} balance correction(s) (${liveBalanceCount} live, ${writeOffBalanceCount} write-off)`);

  for (const p of bottlePlans) {
    if (p.target === 'writeoff') {
      await prisma.transaction.update({
        where: { id: p.writeOffId },
        data: { bottleCount: Math.min(0, p.writeOffBottleCount + p.offset) },
      });
    } else {
      await prisma.bottleWallet.update({ where: { customerId_productId: { customerId: p.customerId, productId: p.productId } }, data: { balance: { decrement: p.offset } } });
    }
  }
  console.log(`   applied ${bottlePlans.length} wallet correction(s) (${liveWalletCount} live, ${writeOffWalletCount} write-off)`);

  console.log('\n✅ Backfill complete.\n');
}

main().catch((e) => { console.error('❌ Backfill failed:', e); process.exit(1); }).finally(() => prisma.$disconnect());
