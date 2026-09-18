'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  Ban, CheckCircle2, ExternalLink, Fuel, Link2, LockOpen, Pencil, PencilLine, Receipt, Trash2, Wallet,
  type LucideIcon,
} from 'lucide-react';
import {
  Badge, Button, Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, Skeleton, Tabs, TabsContent,
  TabsList, TabsTrigger, cn,
} from '@water-supply-crm/ui';
import type { CashLedgerRow } from '../api/van-cash-ledger.api';
import { cashLedgerBucketMeta, cashLedgerRowMeta } from '../constants';
import { signedMoney } from '../format';
import { useEntryHistory } from '../hooks/use-van-cash-ledger';
import { EntryHistory, EntryUnavailablePanel, isEntryUnavailableError } from './entry-history';
import { EntryOverview } from './entry-overview';
import { CLOSED_PERIOD_HINT, OVERRIDE_HINT, type RowActionFlags, type RowActionHandlers, type RowLock } from './row-actions-menu';
import { RowStateChips, StateChip } from './timeline-row';
import {
  ENTRY_PARAM, encodeEntryKey, entrySourceLabel, rowAmountLabel, rowShownAmount,
} from './timeline-format';

export type EntryDrawerTab = 'overview' | 'history';

/**
 * Everything the drawer may DO to a row — computed once by the timeline via
 * `deriveRowActions` (so the drawer owns no permission logic) and the same
 * handlers the ⋮ menu uses. `null` in header-only mode (deep link to a row that
 * isn't in a loaded page): nothing is actionable there.
 */
export interface EntryDrawerActions {
  flags: RowActionFlags;
  handlers: RowActionHandlers;
}

interface EntryDetailDrawerProps {
  row: CashLedgerRow | null;
  sourceType: string | null;
  sourceRecordId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTab?: EntryDrawerTab;
  actions: EntryDrawerActions | null;
}

const ACTION_BTN = 'h-11 sm:h-9 flex-1 sm:flex-none gap-2';
const DESTRUCTIVE_BTN = cn(
  ACTION_BTN,
  'border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive',
);

/** `<origin><path>?entry=<type>:<id>` keeping the page's own `from` / `to` / `vanId` filters. */
function buildEntryLink(sourceType: string, sourceRecordId: string): string {
  const current = new URLSearchParams(window.location.search);
  const params = new URLSearchParams();
  for (const key of ['from', 'to', 'vanId']) {
    const value = current.get(key);
    if (value) params.set(key, value);
  }
  params.set(ENTRY_PARAM, encodeEntryKey({ sourceType, sourceRecordId }));
  return `${window.location.origin}${window.location.pathname}?${params.toString()}`;
}

/** An edit / void / correct button with the closed-period treatment (same rules as the ⋮ menu). */
function GuardedButton({
  icon: Icon, label, lock, destructive, onClick,
}: { icon: LucideIcon; label: string; lock: RowLock; destructive?: boolean; onClick: () => void }) {
  const locked = lock === 'locked';
  return (
    <Button
      variant="outline"
      className={destructive ? DESTRUCTIVE_BTN : ACTION_BTN}
      disabled={locked}
      title={locked ? CLOSED_PERIOD_HINT : lock === 'override' ? OVERRIDE_HINT : undefined}
      onClick={onClick}
    >
      <Icon className="h-4 w-4" aria-hidden /> {label}
      {lock === 'override' && <LockOpen className="h-3 w-3 opacity-70" aria-label="needs override" />}
    </Button>
  );
}

function DrawerActionBar({
  row, actions, canCopy, onCopyLink,
}: {
  row: CashLedgerRow | null;
  actions: EntryDrawerActions | null;
  canCopy: boolean;
  onCopyLink: () => void;
}) {
  const primary: ReactNode[] = [];
  const destructive: ReactNode[] = [];

  if (row && actions) {
    const { flags, handlers } = actions;

    if (flags.approve) {
      primary.push(
        <Button key="approve" className={ACTION_BTN} onClick={() => handlers.onApprove(row)}>
          <CheckCircle2 className="h-4 w-4" aria-hidden /> Approve
        </Button>,
      );
    }
    if (flags.correct) {
      primary.push(
        <GuardedButton key="correct" icon={PencilLine} label="Correct" lock={flags.lock} onClick={() => handlers.onCorrectRemittance(row)} />,
      );
    }
    if (flags.editManualCashIn || flags.editCrewCash) {
      primary.push(
        <GuardedButton
          key="edit"
          icon={Pencil}
          label="Edit"
          lock={flags.lock}
          onClick={() => (flags.editManualCashIn ? handlers.onEditManualCashIn(row) : handlers.onEditCrewCash(row))}
        />,
      );
    }
    if (flags.editExpense) {
      primary.push(
        <GuardedButton key="expense" icon={Receipt} label="Edit expense…" lock={flags.lock} onClick={() => handlers.onEditExpense(row)} />,
      );
    }

    if (flags.deleteManualCashIn) {
      destructive.push(
        <GuardedButton key="delete" icon={Trash2} label="Delete entry" lock={flags.lock} destructive onClick={() => handlers.onDeleteManualCashIn(row)} />,
      );
    }
    if (flags.voidRemittance) {
      destructive.push(
        <GuardedButton key="void-rem" icon={Ban} label="Void handover" lock={flags.lock} destructive onClick={() => handlers.onVoidRemittance(row)} />,
      );
    }
    if (flags.voidCrewCash) {
      destructive.push(
        <GuardedButton key="void-crew" icon={Wallet} label="Void crew cash" lock={flags.lock} destructive onClick={() => handlers.onVoidCrewCash(row)} />,
      );
    }
    if (flags.voidFuelTopUp) {
      destructive.push(
        <GuardedButton key="void-fuel" icon={Fuel} label="Void fuel-card top-up" lock={flags.lock} destructive onClick={() => handlers.onVoidFuelTopUp(row)} />,
      );
    }
  }

  // Locked actions are disabled (Radix / native disabled swallow hover) — say why in visible text.
  const f = actions?.flags;
  const hasLockedAction = !!f && f.lock === 'locked' && (
    f.correct || f.editManualCashIn || f.editCrewCash || f.editExpense || f.deleteManualCashIn || f.voidRemittance
    || f.voidCrewCash || f.voidFuelTopUp
  );

  const showSheet = !!row?.dailySheetId;

  return (
    <div
      className="sticky bottom-0 mt-auto border-t border-border/50 bg-background/95 px-5 pt-3 backdrop-blur pb-[max(0.75rem,env(safe-area-inset-bottom))]"
    >
      {hasLockedAction && (
        <p className="mb-2 text-[11px] text-muted-foreground">{CLOSED_PERIOD_HINT}</p>
      )}
      <div className="flex flex-wrap gap-2">
        {primary}
        {destructive}
        {showSheet && (
          <Button asChild variant="ghost" className={ACTION_BTN}>
            <Link href={`/dashboard/daily-sheets/${row?.dailySheetId}`}>
              <ExternalLink className="h-4 w-4" aria-hidden /> Open daily sheet
            </Link>
          </Button>
        )}
        {canCopy && (
          <Button variant="ghost" className={ACTION_BTN} onClick={onCopyLink}>
            <Link2 className="h-4 w-4" aria-hidden /> Copy link
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * The single detail surface for every Cash Ledger entry: an Overview tab (fields
 * + the actions the timeline computed) and a History tab (audit trail). Works
 * from a loaded row, or — for a deep link to a row outside the loaded pages —
 * from the history response's minimal header alone.
 */
export function EntryDetailDrawer({
  row, sourceType, sourceRecordId, open, onOpenChange, initialTab = 'overview', actions,
}: EntryDetailDrawerProps) {
  const [tab, setTab] = useState<EntryDrawerTab>(initialTab);
  const entryId = sourceType && sourceRecordId ? encodeEntryKey({ sourceType, sourceRecordId }) : '';

  // Each open (or a different entry) starts on the tab the opener asked for.
  useEffect(() => {
    if (open) setTab(initialTab);
  }, [open, entryId, initialTab]);

  // Shared cache entry with the History tab — one request serves header-only mode and the timeline.
  const history = useEntryHistory(sourceType, sourceRecordId, open);
  const entry = history.data?.entry;
  const headerOnly = !row;
  const unavailable = headerOnly && history.isError && isEntryUnavailableError(history.error);

  const copyLink = async () => {
    if (!sourceType || !sourceRecordId) return;
    try {
      await navigator.clipboard.writeText(buildEntryLink(sourceType, sourceRecordId));
      toast.success('Link copied');
    } catch {
      toast.error('Could not copy the link');
    }
  };

  // ── Header ────────────────────────────────────────────────────────────────
  let header: ReactNode;
  if (row) {
    const rowMeta = cashLedgerRowMeta(row.type);
    const bucketMeta = cashLedgerBucketMeta(row.bucket);
    const tone = bucketMeta?.text ?? rowMeta.amountClass;
    const shown = rowShownAmount(row);
    header = (
      <>
        <div className="flex flex-wrap items-center gap-1.5">
          {bucketMeta ? (
            <Badge variant="outline" className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold', bucketMeta.chip)}>
              {bucketMeta.label}
            </Badge>
          ) : (
            <Badge variant="outline" className={cn('rounded-full border-transparent px-2 py-0.5 text-[10px] font-bold', rowMeta.color)}>
              {rowMeta.label}
            </Badge>
          )}
          {row.sourceBadge && <Badge variant="secondary" className="text-[10px] font-medium">{row.sourceBadge}</Badge>}
          {row.vanPlateNumber && <Badge variant="secondary" className="font-mono text-[10px]">{row.vanPlateNumber}</Badge>}
        </div>
        <SheetTitle className={cn('break-words text-base font-bold leading-snug', row.isVoided && 'text-muted-foreground line-through')}>
          {row.title}
        </SheetTitle>
        <p className={cn('font-mono text-2xl font-black tabular-nums', tone, row.isVoided && 'line-through opacity-60')}>
          <span aria-hidden>{signedMoney(shown)}</span>
          <span className="sr-only">{rowAmountLabel(row, shown)}</span>
        </p>
        <div className="flex flex-wrap items-center gap-1.5 empty:hidden">
          <RowStateChips row={row} />
        </div>
      </>
    );
  } else if (entry) {
    const tone = entry.amount > 0 ? 'text-emerald-500' : entry.amount < 0 ? 'text-destructive' : 'text-muted-foreground';
    header = (
      <>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary" className="text-[10px] font-medium">{entrySourceLabel(entry.sourceType)}</Badge>
        </div>
        <SheetTitle className={cn('break-words text-base font-bold leading-snug', entry.isVoided && 'text-muted-foreground line-through')}>
          {entry.title}
        </SheetTitle>
        <p className={cn('font-mono text-2xl font-black tabular-nums', tone, entry.isVoided && 'line-through opacity-60')}>
          {signedMoney(entry.amount)}
        </p>
        <div className="flex flex-wrap items-center gap-1.5 empty:hidden">
          {entry.status === 'PENDING' && (
            <StateChip className="border-transparent bg-amber-500/10 text-amber-500">Pending</StateChip>
          )}
          {entry.isVoided && (
            <StateChip icon={Ban} className="border-destructive/50 text-destructive">Voided</StateChip>
          )}
        </div>
      </>
    );
  } else {
    header = (
      <>
        <SheetTitle className="text-base font-bold">Entry details</SheetTitle>
        {!unavailable && (
          <div className="space-y-2" aria-busy="true">
            <Skeleton className="h-4 w-20 rounded-full" />
            <Skeleton className="h-8 w-40" />
          </div>
        )}
      </>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:w-[520px] sm:max-w-[520px]"
        // The body scrolls, not the sheet — keeps the header + action bar pinned.
        style={{ overflowY: 'hidden' }}
      >
        <SheetHeader className="space-y-2 border-b border-border/50 px-5 pb-4 pr-12 pt-5 text-left">
          {header}
          <SheetDescription className="sr-only">Cash ledger entry details and history</SheetDescription>
        </SheetHeader>

        {unavailable ? (
          <div className="flex-1 overflow-y-auto"><EntryUnavailablePanel /></div>
        ) : (
          <Tabs
            value={tab}
            onValueChange={(v) => setTab(v as EntryDrawerTab)}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="border-b border-border/40 px-5 py-2">
              <TabsList className="grid h-11 w-full grid-cols-2 sm:h-10">
                <TabsTrigger value="overview" className="min-h-9">Overview</TabsTrigger>
                <TabsTrigger value="history" className="min-h-9">History</TabsTrigger>
              </TabsList>
            </div>

            <TabsContent
              value="overview"
              className="mt-0 min-h-0 flex-1 flex-col overflow-y-auto data-[state=active]:flex"
            >
              <div className="px-5 py-4">
                <EntryOverview row={row} entry={entry} entryLoading={history.isLoading} />
              </div>
              <DrawerActionBar
                row={row}
                actions={actions}
                canCopy={!!sourceType && !!sourceRecordId}
                onCopyLink={() => void copyLink()}
              />
            </TabsContent>

            <TabsContent value="history" className="mt-0 min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <EntryHistory sourceType={sourceType} sourceRecordId={sourceRecordId} enabled={open} />
            </TabsContent>
          </Tabs>
        )}
      </SheetContent>
    </Sheet>
  );
}
