import type { PrismaService } from '@water-supply-crm/database';
import type { RevertOutcome, RevertRowInput } from './import-definition';

/**
 * Safe revert for CUSTOMERS_OPENING (design doc §5.6) — NOT a full undo. A created customer is
 * removed only if nothing has ever happened to it since the import:
 *   • no operational/financial record references it, and
 *   • its balances still equal what the import wrote, and
 *   • no portal login is linked.
 * Anything else is left alone and reported with a reason. Checks are done per chunk with
 * grouped queries (one query per table, not per customer).
 */

/** Every table that can reference a customer. A hit in any of them blocks the revert. */
const ACTIVITY_SOURCES: { label: string; delegate: string; field: string }[] = [
  { label: 'transactions', delegate: 'transaction', field: 'customerId' },
  { label: 'deliveries', delegate: 'dailySheetItem', field: 'customerId' },
  { label: 'delivery moves', delegate: 'deliveryItemMoveLog', field: 'customerId' },
  { label: 'orders', delegate: 'customerOrder', field: 'customerId' },
  { label: 'tickets', delegate: 'customerTicket', field: 'customerId' },
  { label: 'payment requests', delegate: 'paymentRequest', field: 'customerId' },
  { label: 'damage cases', delegate: 'damageCase', field: 'customerId' },
  { label: 'conversations', delegate: 'conversation', field: 'customerId' },
  { label: 'deposits', delegate: 'customerDeposit', field: 'customerId' },
  { label: 'financial adjustments', delegate: 'customerFinancialAdjustment', field: 'customerId' },
  { label: 'financial adjustments', delegate: 'customerFinancialAdjustment', field: 'counterpartyCustomerId' },
  { label: 'flags', delegate: 'customerFlag', field: 'customerId' },
  { label: 'repricing batches', delegate: 'deliveryRepricingBatch', field: 'customerId' },
  { label: 'staff penalties', delegate: 'staffLedgerEntry', field: 'linkedCustomerId' },
];

const CHUNK = 200;

interface Snapshot {
  financialBalance?: number;
  productId?: string | null;
  walletBalance?: number;
}

async function activityByCustomer(prisma: PrismaService, vendorId: string, ids: string[]): Promise<Map<string, Set<string>>> {
  const hits = new Map<string, Set<string>>();
  const db = prisma as unknown as Record<string, { groupBy: (a: unknown) => Promise<Record<string, string | null>[]> }>;
  for (const src of ACTIVITY_SOURCES) {
    const rows = await db[src.delegate].groupBy({
      by: [src.field],
      where: { [src.field]: { in: ids } },
    });
    for (const r of rows) {
      const id = r[src.field];
      if (!id) continue;
      if (!hits.has(id)) hits.set(id, new Set());
      hits.get(id)?.add(src.label);
    }
  }
  void vendorId; // every id below was already filtered to this vendor
  return hits;
}

export async function revertCustomerRows(
  prisma: PrismaService,
  vendorId: string,
  rows: RevertRowInput[],
  dryRun: boolean,
): Promise<RevertOutcome[]> {
  const outcomes: RevertOutcome[] = [];

  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const ids = chunk.map((r) => r.entityId);

    const customers = await prisma.customer.findMany({
      where: { vendorId, id: { in: ids } },
      select: { id: true, financialBalance: true, userId: true, wallets: { select: { productId: true, balance: true } } },
    });
    const byId = new Map(customers.map((c) => [c.id, c]));
    const activity = await activityByCustomer(prisma, vendorId, [...byId.keys()]);

    for (const row of chunk) {
      const c = byId.get(row.entityId);
      if (!c) {
        outcomes.push({ rowId: row.rowId, result: 'REVERT_SKIPPED', resultCode: 'ALREADY_GONE', resultMessage: 'This customer no longer exists.' });
        continue;
      }
      if (c.userId) {
        outcomes.push({ rowId: row.rowId, result: 'REVERT_SKIPPED', resultCode: 'PORTAL_LINKED', resultMessage: 'The customer has activated a portal login.' });
        continue;
      }
      const used = activity.get(c.id);
      if (used && used.size) {
        outcomes.push({
          rowId: row.rowId,
          result: 'REVERT_SKIPPED',
          resultCode: 'HAS_ACTIVITY',
          resultMessage: `The customer already has ${[...used].join(', ')}.`,
        });
        continue;
      }
      const snap = (row.appliedSnapshot ?? {}) as Snapshot;
      const walletNow = snap.productId ? (c.wallets.find((w) => w.productId === snap.productId)?.balance ?? 0) : 0;
      const otherWalletUsed = c.wallets.some((w) => w.productId !== snap.productId && w.balance !== 0);
      if (
        Math.round(c.financialBalance * 100) !== Math.round((snap.financialBalance ?? 0) * 100) ||
        walletNow !== (snap.walletBalance ?? 0) ||
        otherWalletUsed
      ) {
        outcomes.push({ rowId: row.rowId, result: 'REVERT_SKIPPED', resultCode: 'BALANCE_CHANGED', resultMessage: 'The balance was changed after the import.' });
        continue;
      }

      if (dryRun) {
        outcomes.push({ rowId: row.rowId, result: 'REVERTED' }); // = "would be reverted"
        continue;
      }
      try {
        await prisma.$transaction(async (tx) => {
          await tx.customerDeliverySchedule.deleteMany({ where: { customerId: c.id } });
          await tx.bottleWallet.deleteMany({ where: { customerId: c.id } });
          await tx.customerProductPrice.deleteMany({ where: { customerId: c.id } });
          await tx.customer.delete({ where: { id: c.id } });
        });
        outcomes.push({ rowId: row.rowId, result: 'REVERTED' });
      } catch {
        // A reference we did not anticipate (FK) — leave the customer untouched and say so.
        outcomes.push({ rowId: row.rowId, result: 'REVERT_SKIPPED', resultCode: 'HAS_ACTIVITY', resultMessage: 'The customer is referenced by other records.' });
      }
    }
  }
  return outcomes;
}
