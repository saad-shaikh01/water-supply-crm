/**
 * One-time backfill for DailySheetItem.financialBalanceAfter.
 *
 * WHY: submitDelivery()/addAdhocItem()/addCorrectionItem() had a tx-visibility bug
 * — after writing the customer's new balance via `tx.customer.update(...)` inside a
 * Prisma interactive transaction, the code read it back via `this.prisma.customer
 * .findUnique(...)` (a DIFFERENT connection) instead of `tx.customer.findUnique(...)`.
 * Under Postgres READ COMMITTED isolation, that read can't see the transaction's own
 * uncommitted write, so it silently returned the customer's PRE-delivery balance.
 * Every DailySheetItem recorded before the fix has a stale `financialBalanceAfter`
 * snapshot baked in (this is what the delivery-receipt PDF's "Total Outstanding
 * Balance" reads for the download/re-download path). The fix (already applied,
 * s/this.prisma/tx/ at the three call sites) only prevents this for NEW deliveries
 * going forward — it does not retroactively correct rows already written wrong.
 * This script recomputes those snapshots for every existing COMPLETED/EMPTY_ONLY item.
 *
 * HOW: for each customer, replay their full `Transaction` history (every source that
 * mutates Customer.financialBalance creates a matching Transaction.amount row —
 * verified across recordDelivery, recordPayment, recordAdjustment, and the damage-case
 * charge/reverse flows; nothing was found that mutates financialBalance without one).
 * Transactions sharing a dailySheetItemId (a DELIVERY + its optional PAYMENT) are
 * grouped into one event so they're always applied together. Events are then applied
 * in chronological order to a running total, and each item's own event records the
 * running total at that point as its new financialBalanceAfter.
 *
 * The running total is ANCHORED to the customer's live, already-correct
 * `Customer.financialBalance` (never touched by this bug — only ledger.service.ts's
 * `tx.customer.update` writes it, which was always correct): openingBalance =
 * financialBalance − sum(all transaction amounts). This absorbs any pre-history
 * balance that predates the earliest Transaction row (e.g. a customer's balance at
 * the moment of a historical data import) so the replay is guaranteed to converge to
 * the correct live total, while still getting every INTERMEDIATE snapshot right.
 *
 * Scope: financialBalanceAfter ONLY. bottleBalanceAfter is NOT backfilled here — a
 * separate audit found DamageCase.waive() mutates BottleWallet.balance directly with
 * NO Transaction row for LOST cases, and DAMAGE-case charge Transaction rows record a
 * bottleCount that does NOT correspond to an actual wallet mutation (already applied
 * via the original delivery's emptyReceived) — replaying bottleCount blindly would
 * inject NEW wrong data for affected customers. Left untouched pending a proper audit.
 *
 * Run:  node backfill-financial-balance.mjs                    (real run, all vendors)
 *       node backfill-financial-balance.mjs --dry               (report only, no writes)
 *       node backfill-financial-balance.mjs --vendor=blue-ice    (scope to one vendor slug)
 */
import { PrismaClient } from '@prisma/client';

const DRY = process.argv.includes('--dry');
const vendorArg = process.argv.find((a) => a.startsWith('--vendor='));
const VENDOR_SLUG = vendorArg ? vendorArg.split('=')[1] : null;
const CONCURRENCY = 10;

const prisma = new PrismaClient({ datasources: { db: { url: process.env['DATABASE_URL'] } } });

async function getCustomerIds() {
  const where = VENDOR_SLUG ? { vendor: { slug: VENDOR_SLUG } } : {};
  const customers = await prisma.customer.findMany({ where, select: { id: true } });
  return customers.map((c) => c.id);
}

// Processes one customer: returns { customerId, itemUpdates: Map<itemId, newBalance>,
// openingBalance, txnCount, itemCount, changedCount }
async function processCustomer(customerId) {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { financialBalance: true },
  });
  if (!customer) return null;

  const txns = await prisma.transaction.findMany({
    where: { customerId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, amount: true, dailySheetItemId: true, createdAt: true },
  });

  if (txns.length === 0) return { customerId, itemUpdates: new Map(), openingBalance: customer.financialBalance, txnCount: 0, itemCount: 0, changedCount: 0 };

  // Group transactions sharing a dailySheetItemId into one event (DELIVERY + its
  // PAYMENT always apply together); everything else (payments, adjustments, damage
  // charges — no dailySheetItemId) is its own event.
  const eventsByItem = new Map(); // itemId → { amountSum, timestamp }
  const standaloneEvents = [];
  for (const t of txns) {
    const amt = t.amount ?? 0;
    if (t.dailySheetItemId) {
      const ev = eventsByItem.get(t.dailySheetItemId);
      if (ev) {
        ev.amountSum += amt;
        if (t.createdAt < ev.timestamp) ev.timestamp = t.createdAt;
      } else {
        eventsByItem.set(t.dailySheetItemId, { amountSum: amt, timestamp: t.createdAt, itemId: t.dailySheetItemId });
      }
    } else {
      standaloneEvents.push({ amountSum: amt, timestamp: t.createdAt, itemId: null });
    }
  }
  const events = [...eventsByItem.values(), ...standaloneEvents]
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime() || (a.itemId ?? '').localeCompare(b.itemId ?? ''));

  const totalTxnSum = events.reduce((s, e) => s + e.amountSum, 0);
  const openingBalance = customer.financialBalance - totalTxnSum;

  let running = openingBalance;
  const itemUpdates = new Map();
  for (const ev of events) {
    running += ev.amountSum;
    if (ev.itemId) itemUpdates.set(ev.itemId, Math.round(running * 100) / 100);
  }

  // Compare against currently-stored values to know how many actually change
  const currentItems = await prisma.dailySheetItem.findMany({
    where: { id: { in: [...itemUpdates.keys()] } },
    select: { id: true, financialBalanceAfter: true },
  });
  const currentById = new Map(currentItems.map((i) => [i.id, i.financialBalanceAfter]));
  let changedCount = 0;
  for (const [itemId, newVal] of itemUpdates) {
    const old = currentById.get(itemId);
    if (old == null || Math.abs(old - newVal) > 0.005) changedCount++;
  }

  return { customerId, itemUpdates, openingBalance, txnCount: txns.length, itemCount: itemUpdates.size, changedCount };
}

async function main() {
  console.log(`\n💰 financialBalanceAfter backfill ${DRY ? '(DRY RUN)' : ''}${VENDOR_SLUG ? ` — vendor '${VENDOR_SLUG}'` : ' — ALL vendors'}\n`);

  const customerIds = await getCustomerIds();
  console.log(`Customers to process: ${customerIds.length}\n`);

  let totalItems = 0, totalChanged = 0, totalTxns = 0, processed = 0;
  const bigOpeningBalances = []; // customers whose opening balance is unexpectedly large — worth eyeballing
  let allUpdates = []; // { id, financialBalanceAfter }

  for (let i = 0; i < customerIds.length; i += CONCURRENCY) {
    const batch = customerIds.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map((id) => processCustomer(id).catch((e) => {
      console.error(`\n   ⚠ customer ${id} failed: ${e.message}`);
      return null;
    })));

    for (const r of results) {
      if (!r) continue;
      processed++;
      totalItems += r.itemCount;
      totalChanged += r.changedCount;
      totalTxns += r.txnCount;
      if (Math.abs(r.openingBalance) > 0.005) {
        bigOpeningBalances.push({ customerId: r.customerId, openingBalance: r.openingBalance });
      }
      for (const [itemId, val] of r.itemUpdates) {
        allUpdates.push({ id: itemId, financialBalanceAfter: val });
      }
    }
    process.stdout.write(`\r   processed ${processed}/${customerIds.length} customers — ${totalItems} items, ${totalChanged} would change`);
  }
  process.stdout.write('\n\n');

  console.log(`Transactions scanned : ${totalTxns}`);
  console.log(`Items evaluated      : ${totalItems}`);
  console.log(`Items that WOULD change (snapshot differs from what's stored) : ${totalChanged}`);
  console.log(`Customers with a non-zero opening balance (pre-history — expected for imported customers): ${bigOpeningBalances.length}`);
  if (bigOpeningBalances.length > 0 && bigOpeningBalances.length <= 20) {
    for (const b of bigOpeningBalances) console.log(`   ${b.customerId}: opening ₨${b.openingBalance.toFixed(2)}`);
  }

  if (DRY) {
    console.log('\nDRY RUN complete — no DB writes.\n');
    return;
  }

  console.log('\n--- Writing updates ---');
  const BATCH = 500;
  for (let i = 0; i < allUpdates.length; i += BATCH) {
    const chunk = allUpdates.slice(i, i + BATCH);
    await prisma.$transaction(
      chunk.map((u) => prisma.dailySheetItem.update({
        where: { id: u.id },
        data: { financialBalanceAfter: u.financialBalanceAfter },
      })),
    );
    process.stdout.write(`\r   updated ${Math.min(i + BATCH, allUpdates.length)}/${allUpdates.length}`);
  }
  console.log('\n\n✅ Backfill complete.\n');
}

main().catch((e) => { console.error('❌ Backfill failed:', e); process.exit(1); }).finally(() => prisma.$disconnect());
