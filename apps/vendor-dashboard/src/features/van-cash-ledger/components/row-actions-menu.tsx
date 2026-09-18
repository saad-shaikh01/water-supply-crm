'use client';

import Link from 'next/link';
import {
  MoreVertical, CheckCircle2, PencilLine, Ban, Eye, ExternalLink, ListTree, Fuel, Wallet, History, Pencil, Trash2,
  Receipt, LockOpen, type LucideIcon,
} from 'lucide-react';
import {
  Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, cn,
} from '@water-supply-crm/ui';
import type { CashLedgerRow } from '../api/van-cash-ledger.api';
import { entryKeyOf } from './timeline-format';

/**
 * P4 closed-period state of a row, for every EDIT / VOID / CORRECT action:
 * 'locked' — the period is closed and the user cannot override (actions stay visible but disabled);
 * 'override' — closed but the user holds `override_lock` (actions enabled; the server's rejection opens the global override dialog);
 * 'none' — open period / older server. Approve, View details, History, Open sheet and breakdown are NEVER gated.
 */
export type RowLock = 'none' | 'locked' | 'override';

export const CLOSED_PERIOD_HINT = 'Closed period — ask an admin';
export const OVERRIDE_HINT = 'Closed period — saving asks for an override reason';

export interface RowActionPerms {
  canApprove: boolean;
  canRemitApprove: boolean;
  canRemitVoid: boolean;
}

/** What a row can do — derived ONCE so the row (click target, hint) and the ⋮ menu never disagree. */
export interface RowActionFlags {
  approve: boolean;
  /** Correct applies to the ROOT of a logical remittance only (a delta row's amount is not the chain total). */
  correct: boolean;
  voidRemittance: boolean;
  /** Every row with a (sourceType, sourceRecordId) opens the unified detail drawer (click / "View details"). */
  viewDetails: boolean;
  /** Same gate as `viewDetails` — opens the drawer on its History tab. */
  viewHistory: boolean;
  /** CASH_OUT rows backed by an Expense / FuelLog / VehicleService keep their existing edit router (ExpenseDetailDrawer). */
  editExpense: boolean;
  /** Manual cash-in (OPENING_BALANCE) edited in place — server `canEdit`. */
  editManualCashIn: boolean;
  /** Manual cash-in soft-delete ("Delete entry") — server `canVoid`. */
  deleteManualCashIn: boolean;
  /** Standalone crew cash edit — `canEdit`, or blocked with an explanation the dialog shows. */
  editCrewCash: boolean;
  voidCrewCash: boolean;
  voidFuelTopUp: boolean;
  openSheet: boolean;
  breakdown: boolean;
  /** Payroll settlements are managed in Payroll — a read-only hint, never an action. */
  payrollHint: boolean;
  /** Whether the ⋮ trigger should render at all. */
  hasMenu: boolean;
  /** P4 — see {@link RowLock}. Gates edit / delete / void / correct only (never approve). */
  lock: RowLock;
}

/** `sourceType`s the Expense Center detail drawer can edit (its own EXPENSE / FUEL_LOG / VEHICLE_SERVICE router). */
const EXPENSE_EDITABLE_SOURCES = ['EXPENSE', 'FUEL_LOG', 'VEHICLE_SERVICE'];

export function deriveRowActions(row: CashLedgerRow, perms: RowActionPerms): RowActionFlags {
  const isCashInLike = row.type === 'CASH_IN' || row.type === 'CASH_IN_CORRECTION';
  const isRemittance = row.type === 'CASH_REMITTANCE_OUT';

  const approve = isCashInLike && row.status === 'PENDING' && perms.canApprove && !!row.sourceRecordId;
  // A voided remittance is a terminal audit row — no further actions.
  const canActOnRemittance =
    isRemittance && !row.isVoided && !!row.sourceRecordId && (perms.canRemitApprove || perms.canRemitVoid);
  const correct = canActOnRemittance && perms.canRemitApprove && !row.isCorrection;
  const voidRemittance = canActOnRemittance;
  const viewDetails = entryKeyOf(row) !== null;
  const viewHistory = viewDetails;
  const editExpense =
    row.type === 'CASH_OUT' && !!row.sourceRecordId && EXPENSE_EDITABLE_SOURCES.includes(row.sourceType ?? 'EXPENSE');
  const isManualCashIn = row.type === 'OPENING_BALANCE' && !!row.sourceRecordId;
  const editManualCashIn = isManualCashIn && !!row.canEdit;
  const deleteManualCashIn = isManualCashIn && !!row.canVoid;
  const editCrewCash =
    row.type === 'STANDALONE_CREW_CASH_OUT' && !!row.sourceRecordId && (!!row.canEdit || !!row.editBlockedReason);
  const voidCrewCash = !!row.canVoid && row.type === 'STANDALONE_CREW_CASH_OUT' && !!row.sourceRecordId;
  const voidFuelTopUp = !!row.canVoid && row.type === 'FUEL_CARD_TOPUP_OUT' && !!row.sourceRecordId;
  const openSheet = !!row.dailySheetId;
  const breakdown = isCashInLike && !!row.dailySheetId;
  const payrollHint = row.type === 'PAYROLL_SETTLEMENT_OUT';

  const lock: RowLock = row.periodClosed ? (row.canOverride ? 'override' : 'locked') : 'none';

  const hasMenu =
    approve || correct || voidRemittance || viewDetails || voidCrewCash || voidFuelTopUp || openSheet || breakdown ||
    editExpense || editManualCashIn || deleteManualCashIn || editCrewCash;

  return {
    approve, correct, voidRemittance, viewDetails, viewHistory, editExpense, editManualCashIn, deleteManualCashIn,
    editCrewCash, voidCrewCash, voidFuelTopUp, openSheet, breakdown, payrollHint, hasMenu, lock,
  };
}

export interface RowActionHandlers {
  onApprove: (row: CashLedgerRow) => void;
  onCorrectRemittance: (row: CashLedgerRow) => void;
  onVoidRemittance: (row: CashLedgerRow) => void;
  /** Opens the unified entry drawer on its Overview tab. */
  onViewDetails: (row: CashLedgerRow) => void;
  /** Opens the unified entry drawer on its History tab. */
  onViewHistory: (row: CashLedgerRow) => void;
  /** Closes the unified drawer and opens the Expense Center detail drawer (the Expense/Fuel/Service edit router). */
  onEditExpense: (row: CashLedgerRow) => void;
  onEditManualCashIn: (row: CashLedgerRow) => void;
  onDeleteManualCashIn: (row: CashLedgerRow) => void;
  onEditCrewCash: (row: CashLedgerRow) => void;
  onVoidCrewCash: (row: CashLedgerRow) => void;
  onVoidFuelTopUp: (row: CashLedgerRow) => void;
}

interface RowActionsMenuProps {
  row: CashLedgerRow;
  flags: RowActionFlags;
  handlers: RowActionHandlers;
  breakdownExpanded: boolean;
  onToggleBreakdown: () => void;
}

const ITEM = 'min-h-11 sm:min-h-0 gap-2 cursor-pointer';

/**
 * An edit / void / correct item with the closed-period treatment: disabled with a visible
 * "Closed period — ask an admin" subtext when locked (Radix disabled items swallow hover,
 * so the explanation must be on-screen text, not only a title), or a small LockOpen
 * "override" hint when the user may override.
 */
function GuardedItem({
  icon: Icon, label, lock, destructive, onSelect,
}: { icon: LucideIcon; label: string; lock: RowLock; destructive?: boolean; onSelect: () => void }) {
  const locked = lock === 'locked';
  return (
    <DropdownMenuItem
      className={cn(ITEM, destructive && 'text-destructive focus:text-destructive', locked && 'items-start sm:items-start')}
      disabled={locked}
      title={locked ? CLOSED_PERIOD_HINT : lock === 'override' ? OVERRIDE_HINT : undefined}
      onSelect={onSelect}
    >
      <Icon className={cn('h-4 w-4', locked && 'mt-0.5 shrink-0')} aria-hidden />
      <span className="flex min-w-0 flex-col">
        <span>{label}</span>
        {locked && <span className="text-[10px] font-normal leading-tight text-muted-foreground">{CLOSED_PERIOD_HINT}</span>}
      </span>
      {lock === 'override' && (
        <span className="ml-auto inline-flex items-center gap-1 pl-3 text-[10px] font-normal text-muted-foreground">
          <LockOpen className="h-3 w-3" aria-hidden /> override
        </span>
      )}
    </DropdownMenuItem>
  );
}

export function RowActionsMenu({ row, flags, handlers, breakdownExpanded, onToggleBreakdown }: RowActionsMenuProps) {
  if (!flags.hasMenu) return null;

  const view = flags.viewDetails || flags.viewHistory;
  const primary =
    flags.approve || flags.correct || flags.editManualCashIn || flags.editCrewCash || flags.editExpense;
  const secondary = flags.openSheet || flags.breakdown;
  const destructive =
    flags.voidRemittance || flags.voidCrewCash || flags.voidFuelTopUp || flags.deleteManualCashIn;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-11 w-11 sm:h-8 sm:w-8 -mr-1.5 sm:mr-0 shrink-0 rounded-full text-muted-foreground"
          aria-label={`Actions for ${row.title}`}
        >
          <MoreVertical className="h-4 w-4" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        {flags.viewDetails && (
          <DropdownMenuItem className={ITEM} onSelect={() => handlers.onViewDetails(row)}>
            <Eye className="h-4 w-4" aria-hidden /> View details
          </DropdownMenuItem>
        )}
        {flags.viewHistory && (
          <DropdownMenuItem className={ITEM} onSelect={() => handlers.onViewHistory(row)}>
            <History className="h-4 w-4" aria-hidden /> History
          </DropdownMenuItem>
        )}

        {view && primary && <DropdownMenuSeparator />}

        {flags.approve && (
          <DropdownMenuItem className={ITEM} onSelect={() => handlers.onApprove(row)}>
            <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden /> Approve
          </DropdownMenuItem>
        )}
        {flags.correct && (
          <GuardedItem
            icon={PencilLine} label="Correct" lock={flags.lock}
            onSelect={() => handlers.onCorrectRemittance(row)}
          />
        )}
        {(flags.editManualCashIn || flags.editCrewCash) && (
          <GuardedItem
            icon={Pencil} label="Edit" lock={flags.lock}
            onSelect={() => (flags.editManualCashIn ? handlers.onEditManualCashIn(row) : handlers.onEditCrewCash(row))}
          />
        )}
        {flags.editExpense && (
          <GuardedItem
            icon={Receipt} label="Edit expense…" lock={flags.lock}
            onSelect={() => handlers.onEditExpense(row)}
          />
        )}

        {(view || primary) && secondary && <DropdownMenuSeparator />}

        {flags.openSheet && (
          <DropdownMenuItem asChild className={ITEM}>
            <Link href={`/dashboard/daily-sheets/${row.dailySheetId}`}>
              <ExternalLink className="h-4 w-4" aria-hidden /> Open daily sheet
            </Link>
          </DropdownMenuItem>
        )}
        {flags.breakdown && (
          <DropdownMenuItem className={ITEM} onSelect={onToggleBreakdown}>
            <ListTree className="h-4 w-4" aria-hidden /> {breakdownExpanded ? 'Hide' : 'Show'} cash breakdown
          </DropdownMenuItem>
        )}

        {(view || primary || secondary) && destructive && <DropdownMenuSeparator />}

        {flags.voidRemittance && (
          <GuardedItem
            icon={Ban} label="Void handover" lock={flags.lock} destructive
            onSelect={() => handlers.onVoidRemittance(row)}
          />
        )}
        {flags.voidCrewCash && (
          <GuardedItem
            icon={Wallet} label="Void crew cash" lock={flags.lock} destructive
            onSelect={() => handlers.onVoidCrewCash(row)}
          />
        )}
        {flags.deleteManualCashIn && (
          <GuardedItem
            icon={Trash2} label="Delete entry" lock={flags.lock} destructive
            onSelect={() => handlers.onDeleteManualCashIn(row)}
          />
        )}
        {flags.voidFuelTopUp && (
          <GuardedItem
            icon={Fuel} label="Void fuel-card top-up" lock={flags.lock} destructive
            onSelect={() => handlers.onVoidFuelTopUp(row)}
          />
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
