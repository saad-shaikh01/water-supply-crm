import { money, pktDayKey } from '../format';
import type { CashLedgerDirection, CashLedgerRow, CashLedgerRowType } from '../api/van-cash-ledger.api';

/**
 * A running / opening / closing balance. `money()` is magnitude-only, so a
 * negative balance (cash overdrawn) would otherwise read as positive — keep
 * the minus explicit here.
 */
export const balanceText = (n: number | null | undefined): string => {
  const v = Number(n ?? 0);
  return v < 0 ? `− ${money(v)}` : money(v);
};

/** Text tone for a balance figure: red when negative, else inherit. */
export const balanceTone = (n: number | null | undefined): string | undefined =>
  Number(n ?? 0) < 0 ? 'text-destructive' : undefined;

// ── Unified entry helpers (P2) ──────────────────────────────────────────────

/** Query-string key of the unified detail drawer's deep link: `?entry=<sourceType>:<sourceRecordId>`. */
export const ENTRY_PARAM = 'entry';

export interface EntryKey {
  sourceType: string;
  sourceRecordId: string;
}

/** Server `sourceType` per row type — only used when an older payload omits `sourceType` on a non-CASH_OUT row. */
const FALLBACK_SOURCE_TYPE: Partial<Record<CashLedgerRowType, string>> = {
  OPENING_BALANCE: 'OPENING_BALANCE',
  CASH_IN: 'VAN_CASH_HANDOVER',
  CASH_IN_CORRECTION: 'VAN_CASH_HANDOVER',
  CASH_REMITTANCE_OUT: 'OFFICE_CASH_REMITTANCE',
  FUEL_CARD_TOPUP_OUT: 'FUEL_CARD_TOPUP',
  STANDALONE_CREW_CASH_OUT: 'STANDALONE_CREW_CASH',
  PAYROLL_SETTLEMENT_OUT: 'SETTLEMENT',
};

/** The (sourceType, sourceRecordId) pair that identifies a row for history / deep links; null when it has none. */
export function entryKeyOf(row: CashLedgerRow): EntryKey | null {
  if (!row.sourceRecordId) return null;
  const sourceType = row.sourceType ?? FALLBACK_SOURCE_TYPE[row.type];
  return sourceType ? { sourceType, sourceRecordId: row.sourceRecordId } : null;
}

export const encodeEntryKey = (key: EntryKey): string => `${key.sourceType}:${key.sourceRecordId}`;

/** Splits on the FIRST colon (ids are uuids and never contain one). Anything malformed → null. */
export function parseEntryKey(param: string | null | undefined): EntryKey | null {
  if (!param) return null;
  const idx = param.indexOf(':');
  if (idx <= 0) return null;
  const sourceType = param.slice(0, idx);
  const sourceRecordId = param.slice(idx + 1);
  if (!/^[A-Z][A-Z_]{1,39}$/.test(sourceType)) return null;
  if (!sourceRecordId || sourceRecordId.length > 100 || /\s/.test(sourceRecordId)) return null;
  return { sourceType, sourceRecordId };
}

/** Server `direction` wins; older servers / stale caches fall back to the row type. */
export function rowDirection(row: CashLedgerRow): CashLedgerDirection {
  if (row.direction) return row.direction;
  switch (row.type) {
    case 'OPENING_BALANCE':
    case 'CASH_IN':
    case 'CASH_IN_CORRECTION':
      return 'IN';
    case 'CASH_REMITTANCE_OUT':
    case 'FUEL_CARD_TOPUP_OUT':
      return 'TRANSFER';
    default:
      return 'OUT';
  }
}

/**
 * The signed figure to SHOW for a row. A voided row folds into the ledger as 0
 * — show what it WAS (struck through by the caller) so the audit trail reads.
 */
export function rowShownAmount(row: CashLedgerRow): number {
  const direction = rowDirection(row);
  const inbound = row.amount !== 0 ? row.amount > 0 : direction === 'IN';
  return row.isVoided && row.amount === 0 ? (inbound ? 1 : -1) * row.displayAmount : row.amount;
}

/** Screen-reader sentence for an amount ("voided, out, 1,200 rupees"). */
export function rowAmountLabel(row: CashLedgerRow, shownAmount: number): string {
  const direction = rowDirection(row);
  const dirWord = shownAmount > 0 ? 'in' : direction === 'TRANSFER' ? 'transfer out' : 'out';
  return `${row.isVoided ? 'voided, ' : ''}${dirWord}, ${Math.abs(shownAmount).toLocaleString('en-PK')} rupees`;
}

/** Readable label for a `sourceType` (header-only drawer mode, where there is no row / bucket to label it). */
export const entrySourceLabel = (sourceType: string): string => {
  switch (sourceType) {
    case 'OPENING_BALANCE': return 'Manual Cash In';
    case 'VAN_CASH_HANDOVER': return 'Sheet Cash In';
    case 'OFFICE_CASH_REMITTANCE': return 'Handover Out';
    case 'FUEL_CARD_TOPUP': return 'Fuel Card Top-up';
    case 'STANDALONE_CREW_CASH':
    case 'CREW_CASH': return 'Crew Cash';
    case 'SETTLEMENT':
    case 'STAFF_LEDGER': return 'Payroll Cash';
    case 'EXPENSE': return 'Expense';
    case 'FUEL_LOG': return 'Fuel Log';
    case 'VEHICLE_SERVICE': return 'Vehicle Service';
    default: return sourceType.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
  }
};

// ── Accounting periods (P4) ─────────────────────────────────────────────────

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** `"2026-08"` → `"Aug 2026"`. Anything that is not a YYYY-MM label is returned as-is (never throws). */
export function periodDisplayLabel(label: string | null | undefined): string {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(label ?? '');
  return m ? `${MONTH_ABBR[Number(m[2]) - 1]} ${m[1]}` : (label ?? '');
}

/** Human month (`"Sep 2026"`) of an ISO instant, in the vendor timezone (the calendar the periods use). */
export const monthLabelOf = (iso: string): string => periodDisplayLabel(pktDayKey(iso).slice(0, 7));

/** Short sentence used as the `title` of the closed-period chip. */
export const closedPeriodTitle = (row: CashLedgerRow): string =>
  `${row.periodLabel ? periodDisplayLabel(row.periodLabel) : 'This period'} is closed — changes need an admin override with a reason`;
