import type { PrismaService } from '@water-supply-crm/database';
import type { RevertOutcome, RevertRowInput } from './import-definition';

/**
 * Batch-level revert for TRANSACTION_HISTORY. History never touched the customer's balance or
 * wallet (EXPLAIN mode), so reverting is only deleting the Transaction rows this import wrote -
 * identified by the ids recorded in each ImportRow's `appliedSnapshot.txIds` (no column on
 * Transaction). Works for both reporting modes.
 *
 * A row is left alone (REVERT_SKIPPED) when its transactions were edited afterwards or are tied
 * to something else; ones already gone are reported, not an error.
 */

const CHUNK = 250;

interface Snapshot {
  txIds?: string[];
}

export async function revertHistoryRows(prisma: PrismaService, vendorId: string, rows: RevertRowInput[], dryRun: boolean): Promise<RevertOutcome[]> {
  const outcomes: RevertOutcome[] = [];

  for (let i = 0; i < rows.length; i += CHUNK) {
    const part = rows.slice(i, i + CHUNK);
    const idsOf = (r: RevertRowInput) => ((r.appliedSnapshot ?? {}) as Snapshot).txIds ?? [];
    const allIds = part.flatMap(idsOf);
    const found = allIds.length
      ? await prisma.transaction.findMany({
          where: { id: { in: allIds }, vendorId },
          select: { id: true, lastEditedAt: true, dailySheetItemId: true, paymentRequestId: true, adjustmentId: true },
        })
      : [];
    const byId = new Map(found.map((t) => [t.id, t]));

    const deletable: string[] = [];
    const plan: { row: RevertRowInput; ids: string[]; outcome?: RevertOutcome }[] = [];
    for (const r of part) {
      const ids = idsOf(r).filter((id) => byId.has(id));
      if (ids.length === 0) {
        plan.push({ row: r, ids, outcome: { rowId: r.rowId, result: 'REVERT_SKIPPED', resultCode: 'ALREADY_GONE', resultMessage: 'These transactions no longer exist.' } });
        continue;
      }
      const touched = ids.some((id) => {
        const t = byId.get(id);
        return !!t && (t.lastEditedAt !== null || t.dailySheetItemId !== null || t.paymentRequestId !== null || t.adjustmentId !== null);
      });
      if (touched) {
        plan.push({ row: r, ids, outcome: { rowId: r.rowId, result: 'REVERT_SKIPPED', resultCode: 'EDITED', resultMessage: 'These transactions were changed after the import.' } });
        continue;
      }
      plan.push({ row: r, ids });
      deletable.push(...ids);
    }

    if (!dryRun && deletable.length) {
      try {
        await prisma.transaction.deleteMany({ where: { id: { in: deletable }, vendorId } });
      } catch {
        // Something references a transaction we did not anticipate: fall back to one row at a time.
        for (const p of plan) {
          if (p.outcome) continue;
          try {
            await prisma.transaction.deleteMany({ where: { id: { in: p.ids }, vendorId } });
          } catch {
            p.outcome = { rowId: p.row.rowId, result: 'REVERT_SKIPPED', resultCode: 'HAS_ACTIVITY', resultMessage: 'These transactions are referenced by other records.' };
          }
        }
      }
    }
    for (const p of plan) outcomes.push(p.outcome ?? { rowId: p.row.rowId, result: 'REVERTED' });
  }
  return outcomes;
}
