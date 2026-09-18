'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryState, parseAsString } from 'nuqs';
import { Button, cn } from '@water-supply-crm/ui';
import { useCan } from '../../authz/hooks/use-can';
import { useInfiniteCashLedgerTimeline } from '../hooks/use-van-cash-ledger';
import { VAN_CASH_LEDGER_PERMISSIONS } from '../constants';
import { rangeLastMonth } from '../../../lib/date-pkt';
import { pktDayKey } from '../format';
import { ApproveHandoverDialog, type HandoverApprovalTarget } from './approve-handover-dialog';
import { VoidRemittanceDialog, type RemittanceVoidTarget } from './void-remittance-dialog';
import { CorrectRemittanceDialog, type RemittanceCorrectTarget } from './correct-remittance-dialog';
import { VoidCrewCashDialog, type CrewCashVoidTarget } from './void-crew-cash-dialog';
import { EditManualCashInDialog } from './edit-manual-cash-in-dialog';
import { VoidManualCashInDialog } from './void-manual-cash-in-dialog';
import { EditStandaloneCrewCashDialog } from './edit-standalone-crew-cash-dialog';
import { EntryDetailDrawer, type EntryDrawerTab } from './entry-detail-drawer';
import { VoidTopUpDialog, type TopUpVoidTarget } from '../../fuel-cards/components/void-topup-dialog';
import type { CashLedgerDayStatement, CashLedgerRow } from '../api/van-cash-ledger.api';
import { ExpenseDetailDrawer } from '../../expense-center/detail/expense-detail-drawer';
import type {
  ExpenseCenterRow, ExpenseCenterDomain, ExpenseCenterSourceType,
} from '../../expense-center/api/expense-center.api';
import { TimelineDayGroup } from './timeline-day-group';
import {
  TimelineRowSkeleton, TimelineSkeleton, TimelineEmpty, TimelineFilteredEmpty, TimelineError, InlineRetry,
} from './timeline-states';
import { useCashLedgerFilters } from '../hooks/use-cash-ledger-filters';
import { deriveRowActions, type RowActionHandlers, type RowActionPerms } from './row-actions-menu';
import { ENTRY_PARAM, encodeEntryKey, entryKeyOf, parseEntryKey } from './timeline-format';

/**
 * CASH_OUT rows are the Cash Ledger's own read-projection of the exact same
 * Expense/FuelLog/VehicleService/StaffLedger records the Expense Center's
 * Timeline shows (see `normalizeCashOut` server-side) — so rather than build
 * a second edit surface, this adapts the row back into an `ExpenseCenterRow`
 * and hands it to the Expense Center's own detail drawer verbatim.
 */
function toExpenseCenterRow(row: CashLedgerRow): ExpenseCenterRow {
  return {
    id: row.id,
    date: row.date,
    domain: (row.domain ?? 'OFFICE') as ExpenseCenterDomain,
    category: row.category ?? '',
    categoryLabel: row.categoryLabel ?? row.title,
    title: row.title,
    amount: row.displayAmount,
    costSign: row.costSign ?? 'DEBIT',
    paidFromCash: row.paidFromCash ?? null,
    recordedByName: row.submittedByName,
    sourceType: (row.sourceType ?? 'EXPENSE') as ExpenseCenterSourceType,
    sourceBadge: row.sourceBadge,
    vanPlateNumber: row.vanPlateNumber,
    employeeName: row.employeeName ?? null,
    sourceRecordId: row.sourceRecordId ?? '',
    locked: row.locked ?? false,
    lockedReason: row.lockedReason ?? null,
  };
}

const remittanceTarget = (row: CashLedgerRow) => ({
  sourceRecordId: row.sourceRecordId as string,
  amount: row.displayAmount ?? Math.abs(row.amount),
  destinationLabel: row.sourceBadge,
  version: row.version ?? 1,
});

/** Server titles a top-up row `Fuel card top-up — {card name}`; recover the card name for the void dialog. */
const fuelCardName = (row: CashLedgerRow): string => {
  const idx = row.title.indexOf('—');
  const name = idx >= 0 ? row.title.slice(idx + 1).trim() : '';
  return name || row.sourceBadge || 'Fuel Card';
};

export function CashLedgerTimeline() {
  const {
    data, isLoading, isError, error, refetch, isFetching, isPlaceholderData,
    isFetchingNextPage, isFetchNextPageError, isRefetchError, hasNextPage, fetchNextPage,
  } = useInfiniteCashLedgerTimeline();

  const { anyActive: anyFilterActive, clearFilters } = useCashLedgerFilters();

  const canApprove = useCan(VAN_CASH_LEDGER_PERMISSIONS.approve);
  const canRemitApprove = useCan(VAN_CASH_LEDGER_PERMISSIONS.remitApprove);
  const canRemitVoid = useCan(VAN_CASH_LEDGER_PERMISSIONS.remitVoid);

  const [vanId, setVanId] = useQueryState('vanId', parseAsString.withDefault(''));
  const [, setFrom] = useQueryState('from', parseAsString.withDefault(''));
  const [, setTo] = useQueryState('to', parseAsString.withDefault(''));

  const [approveTarget, setApproveTarget] = useState<HandoverApprovalTarget | null>(null);
  const [voidTarget, setVoidTarget] = useState<RemittanceVoidTarget | null>(null);
  const [correctTarget, setCorrectTarget] = useState<RemittanceCorrectTarget | null>(null);
  const [crewCashTarget, setCrewCashTarget] = useState<CrewCashVoidTarget | null>(null);
  const [topUpTarget, setTopUpTarget] = useState<TopUpVoidTarget | null>(null);
  // Expense Center detail drawer — the Expense / Fuel / Service edit router, reached via "Edit expense…".
  const [detailRow, setDetailRow] = useState<CashLedgerRow | null>(null);
  const [editManualRow, setEditManualRow] = useState<CashLedgerRow | null>(null);
  const [deleteManualRow, setDeleteManualRow] = useState<CashLedgerRow | null>(null);
  const [editCrewRow, setEditCrewRow] = useState<CashLedgerRow | null>(null);
  const [showVoided, setShowVoided] = useState(false);

  // Unified entry drawer. The URL is the source of truth: `?entry=<sourceType>:<sourceRecordId>` (shallow, replace).
  const [entryParam, setEntryParam] = useQueryState(
    ENTRY_PARAM,
    parseAsString.withDefault('').withOptions({ shallow: true, scroll: false, history: 'replace' }),
  );
  const [drawerTab, setDrawerTab] = useState<EntryDrawerTab>('overview');
  const openKey = useMemo(() => parseEntryKey(entryParam), [entryParam]);
  // The initial URL had an entry param — used once to scroll the matched row into view.
  const deepLinkPending = useRef(!!entryParam);

  const openEntry = useCallback((row: CashLedgerRow, tab: EntryDrawerTab) => {
    const key = entryKeyOf(row);
    if (!key) return;
    setDrawerTab(tab);
    void setEntryParam(encodeEntryKey(key));
  }, [setEntryParam]);
  const closeEntry = useCallback(() => { void setEntryParam(null); }, [setEntryParam]);

  const perms: RowActionPerms = { canApprove, canRemitApprove, canRemitVoid };

  const handlers: RowActionHandlers = {
    onApprove: (row) => {
      if (!row.sourceRecordId) return;
      setApproveTarget({
        sourceRecordId: row.sourceRecordId,
        dailySheetId: row.dailySheetId,
        vanPlateNumber: row.vanPlateNumber,
        driverName: row.submittedByName,
        date: row.date,
        amount: row.amount,
        // Timeline CASH_IN / CASH_IN_CORRECTION rows carry their handover's real
        // version — the `?? 1` only satisfies the type for rows that never get here.
        version: row.version ?? 1,
      });
    },
    onVoidRemittance: (row) => {
      if (row.sourceRecordId) setVoidTarget(remittanceTarget(row));
    },
    onCorrectRemittance: (row) => {
      if (row.sourceRecordId) setCorrectTarget(remittanceTarget(row));
    },
    onViewDetails: (row) => openEntry(row, 'overview'),
    onViewHistory: (row) => openEntry(row, 'history'),
    onEditExpense: (row) => {
      closeEntry();
      setDetailRow(row);
    },
    onEditManualCashIn: (row) => setEditManualRow(row),
    onDeleteManualCashIn: (row) => setDeleteManualRow(row),
    onEditCrewCash: (row) => setEditCrewRow(row),
    onVoidCrewCash: (row) => {
      if (!row.sourceRecordId) return;
      setCrewCashTarget({
        id: row.sourceRecordId,
        amount: row.displayAmount ?? Math.abs(row.amount),
        employeeName: row.employeeName ?? null,
      });
    },
    onVoidFuelTopUp: (row) => {
      if (!row.sourceRecordId) return;
      setTopUpTarget({
        id: row.sourceRecordId,
        amount: row.displayAmount ?? Math.abs(row.amount),
        cardName: fuelCardName(row),
      });
    },
  };

  // Rows are newest-first across pages. A row can shift between pages while the
  // user is loading more, so de-dupe by type:id to keep React keys unique.
  const { rows, dayStatements, total } = useMemo(() => {
    const pages = data?.pages ?? [];
    const seen = new Set<string>();
    const all: CashLedgerRow[] = [];
    const statements: Record<string, CashLedgerDayStatement> = {};
    for (const page of pages) {
      for (const row of page.data ?? []) {
        const key = `${row.type}:${row.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        all.push(row);
      }
      Object.assign(statements, page.meta?.dayStatements ?? {});
    }
    return { rows: all, dayStatements: statements, total: pages[pages.length - 1]?.meta?.total ?? 0 };
  }, [data]);

  const voidedCount = useMemo(() => rows.filter((r) => r.isVoided).length, [rows]);

  // The row behind the open drawer, when it is inside the loaded pages (else the drawer runs header-only).
  const matchedRow = useMemo(() => {
    if (!openKey) return null;
    return rows.find((r) => {
      const key = entryKeyOf(r);
      return !!key && key.sourceType === openKey.sourceType && key.sourceRecordId === openKey.sourceRecordId;
    }) ?? null;
  }, [rows, openKey]);

  // Deep link on page load: reveal (un-hide if voided) and scroll the matched row into view, once.
  useEffect(() => {
    if (!deepLinkPending.current || isLoading) return;
    deepLinkPending.current = false;
    if (!matchedRow) return;
    if (matchedRow.isVoided) setShowVoided(true);
    const key = entryKeyOf(matchedRow);
    if (!key) return;
    const id = encodeEntryKey(key);
    requestAnimationFrame(() => {
      const el = Array.from(document.querySelectorAll<HTMLElement>('[data-entry-key]')).find(
        (node) => node.dataset.entryKey === id,
      );
      el?.scrollIntoView({ block: 'center' });
    });
  }, [isLoading, matchedRow]);

  const days = useMemo(() => {
    const visible = showVoided ? rows : rows.filter((r) => !r.isVoided);
    const byDay = new Map<string, CashLedgerRow[]>();
    for (const row of visible) {
      const key = pktDayKey(row.date);
      const bucket = byDay.get(key);
      if (bucket) bucket.push(row);
      else byDay.set(key, [row]);
    }
    return Array.from(byDay, ([dayKey, dayRows]) => ({ dayKey, dayRows }));
  }, [rows, showVoided]);

  const refreshing = !isLoading && !isFetchingNextPage && (isPlaceholderData || isFetching);
  const firstPageEmpty = !!data && (data.pages[0]?.meta?.total ?? 0) === 0;

  let body: ReactNode;
  if (isLoading) {
    body = <TimelineSkeleton />;
  } else if (isError && !data) {
    body = <TimelineError error={error} onRetry={() => void refetch()} retrying={isFetching} />;
  } else if (firstPageEmpty && anyFilterActive) {
    // Zero rows BECAUSE of the entry filters — not an empty period.
    body = <TimelineFilteredEmpty onClearFilters={clearFilters} />;
  } else if (firstPageEmpty) {
    body = (
      <TimelineEmpty
        hasVanFilter={!!vanId}
        onShowLastMonth={() => {
          const r = rangeLastMonth();
          void setFrom(r.from);
          void setTo(r.to);
        }}
        onClearVan={() => void setVanId(null)}
      />
    );
  } else {
    body = (
      <>
        {isRefetchError && !isFetchNextPageError && (
          <InlineRetry
            label="Couldn't refresh the ledger — showing the last loaded data."
            onRetry={() => void refetch()}
            retrying={isFetching}
          />
        )}

        {days.length === 0 ? (
          <p className="rounded-2xl border border-border/40 bg-card/30 px-4 py-6 text-center text-xs text-muted-foreground">
            Every loaded entry is voided. Use “Show voided” to see them.
          </p>
        ) : (
          <div className={cn('space-y-4', refreshing && 'opacity-60')} aria-busy={refreshing}>
            {days.map(({ dayKey, dayRows }, i) => (
              <TimelineDayGroup
                key={dayKey}
                dayKey={dayKey}
                statement={dayStatements[dayKey]}
                rows={dayRows}
                // The last loaded day may continue on the next page — its closing footer would be premature.
                continues={!!hasNextPage && i === days.length - 1}
                perms={perms}
                handlers={handlers}
              />
            ))}
          </div>
        )}

        {isFetchingNextPage && (
          <div className="space-y-2" aria-busy="true">
            <TimelineRowSkeleton />
            <TimelineRowSkeleton />
          </div>
        )}

        {isFetchNextPageError && (
          <InlineRetry
            label="Couldn't load more entries."
            onRetry={() => void fetchNextPage()}
            retrying={isFetchingNextPage}
          />
        )}

        <div className="flex flex-col items-center gap-2 pt-2">
          <p className="text-[11px] text-muted-foreground tabular-nums">
            Showing {rows.length.toLocaleString('en-PK')} of {total.toLocaleString('en-PK')}
          </p>
          {hasNextPage && !isFetchNextPageError && (
            <Button
              variant="outline"
              size="sm"
              className="h-11 sm:h-9 min-w-40"
              onClick={() => void fetchNextPage()}
              disabled={isFetchingNextPage}
            >
              {isFetchingNextPage ? 'Loading…' : 'Load more'}
            </Button>
          )}
        </div>
      </>
    );
  }

  return (
    // pb-28 keeps the floating mini-bar / "+" from ever covering the Load more button.
    <div className="space-y-3 pb-28">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground">Cash Ledger Timeline</h2>
        {voidedCount > 0 && (
          <button
            type="button"
            aria-pressed={showVoided}
            onClick={() => setShowVoided((v) => !v)}
            className={cn(
              'inline-flex items-center min-h-11 sm:min-h-8 rounded-full border px-3 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              showVoided
                ? 'border-destructive/50 bg-destructive/10 text-destructive'
                : 'border-border/60 text-muted-foreground hover:text-foreground',
            )}
          >
            {showVoided ? 'Hide' : 'Show'} voided ({voidedCount})
          </button>
        )}
      </div>

      {body}

      <ApproveHandoverDialog
        target={approveTarget}
        open={!!approveTarget}
        onOpenChange={(o) => { if (!o) setApproveTarget(null); }}
      />
      <VoidRemittanceDialog
        target={voidTarget}
        open={!!voidTarget}
        onOpenChange={(o) => { if (!o) setVoidTarget(null); }}
      />
      <CorrectRemittanceDialog
        target={correctTarget}
        open={!!correctTarget}
        onOpenChange={(o) => { if (!o) setCorrectTarget(null); }}
      />
      <VoidCrewCashDialog
        target={crewCashTarget}
        open={!!crewCashTarget}
        onOpenChange={(o) => { if (!o) setCrewCashTarget(null); }}
      />
      <VoidTopUpDialog
        target={topUpTarget}
        open={!!topUpTarget}
        onOpenChange={(o) => { if (!o) setTopUpTarget(null); }}
      />
      <EditManualCashInDialog
        row={editManualRow}
        open={!!editManualRow}
        onOpenChange={(o) => { if (!o) setEditManualRow(null); }}
      />
      <VoidManualCashInDialog
        row={deleteManualRow}
        open={!!deleteManualRow}
        onOpenChange={(o) => { if (!o) setDeleteManualRow(null); }}
      />
      <EditStandaloneCrewCashDialog
        row={editCrewRow}
        open={!!editCrewRow}
        onOpenChange={(o) => { if (!o) setEditCrewRow(null); }}
        onRequestVoid={() => {
          const target = editCrewRow;
          setEditCrewRow(null);
          if (target) handlers.onVoidCrewCash(target);
        }}
      />
      <ExpenseDetailDrawer
        row={detailRow ? toExpenseCenterRow(detailRow) : null}
        open={!!detailRow}
        onOpenChange={(o) => { if (!o) setDetailRow(null); }}
      />
      <EntryDetailDrawer
        row={matchedRow}
        sourceType={openKey?.sourceType ?? null}
        sourceRecordId={openKey?.sourceRecordId ?? null}
        // Wait for the first page so a deep link opens straight into the full row view, not header-only.
        open={!!openKey && !isLoading}
        onOpenChange={(o) => { if (!o) closeEntry(); }}
        initialTab={drawerTab}
        actions={matchedRow ? { flags: deriveRowActions(matchedRow, perms), handlers } : null}
      />
    </div>
  );
}
