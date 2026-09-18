import { BadRequestException } from '@nestjs/common';
import { vendorDateString } from '../../common/helpers/date.util';
import { shortSheetId } from '../expense-center/expense-center-domain.util';
import type { CashLedgerBucket } from './cash-ledger-buckets';
import type {
  CashLedgerFilteredMeta,
  CashLedgerRemittanceDestination,
  CashLedgerStatusFilter,
  CashLedgerTimelineFilters,
} from './cash-ledger-contract';
import { pktDay } from './cash-ledger-sort';

/**
 * Cash Ledger P3 — timeline entry filters. PURE: no DB, no Nest. The service
 * folds the running balance / per-day statements over the WHOLE (unfiltered)
 * window first and only then calls `matchesFilters`, so a filter can never
 * change a row's `runningBalance` (invariant I5).
 *
 * Semantics: filter GROUPS combine with AND; values inside one array OR.
 */

/** The row fields the filters read (structurally satisfied by `VanCashLedgerRow`). */
export interface FilterableLedgerRow {
  type: string;
  bucket: CashLedgerBucket;
  /** ISO — when the source record was created. */
  createdAt: string;
  amount: number;
  displayAmount: number;
  status?: string | null;
  isVoided?: boolean;
  isCorrection?: boolean;
  lagDays?: number;
  isEdited?: boolean;
  recordedById?: string | null;
  approvedById?: string | null;
  employeeId?: string | null;
  category?: string;
  hasAttachment?: boolean;
  notes?: string | null;
  dailySheetId?: string | null;
  reference?: string | null;
  destination?: string | null;
  title?: string;
  employeeName?: string | null;
  vanPlateNumber?: string | null;
  categoryLabel?: string;
  sourceBadge?: string;
  recordedByName?: string | null;
  approvedByName?: string | null;
}

/** Search text shorter than this (after trim) is ignored by the server. */
export const MIN_SEARCH_LENGTH = 2;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function present<T>(list: readonly T[] | undefined): list is readonly T[] {
  return Array.isArray(list) && list.length > 0;
}

/** Trimmed search text, or `null` when it is too short to search. */
export function normalizeSearch(q: string | undefined): string | null {
  const trimmed = (q ?? '').trim();
  return trimmed.length >= MIN_SEARCH_LENGTH ? trimmed : null;
}

/** `#a1b2` / `A1B2` → `A1B2`; `null` when nothing is left. */
function normalizeSheetPrefix(sheet: string | undefined): string | null {
  const cleaned = (sheet ?? '').trim().replace(/^#/, '').trim().toUpperCase();
  return cleaned.length >= 1 ? cleaned : null;
}

/** PKT day key for a `YYYY-MM-DD` or ISO timestamp filter bound. */
function dayKey(input: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(input) ? input : vendorDateString(new Date(input));
}

function isHandoverFamily(row: FilterableLedgerRow): boolean {
  return row.type === 'CASH_IN' || row.type === 'CASH_IN_CORRECTION';
}

function isPending(row: FilterableLedgerRow): boolean {
  return row.status === 'PENDING';
}

function matchesStatus(row: FilterableLedgerRow, wanted: readonly CashLedgerStatusFilter[]): boolean {
  return wanted.some((status) => {
    switch (status) {
      case 'PENDING':
        return isPending(row);
      case 'VOIDED':
        return !!row.isVoided;
      case 'CORRECTED':
        return row.type === 'CASH_IN_CORRECTION' || !!row.isCorrection;
      case 'APPROVED':
        // Rows with no approval concept (expenses, fuel, crew cash...) count as approved.
        return !isPending(row) && !row.isVoided;
      default:
        return false;
    }
  });
}

function searchHaystack(row: FilterableLedgerRow): string {
  return [
    row.title,
    row.notes,
    row.reference,
    row.employeeName,
    row.vanPlateNumber,
    row.categoryLabel,
    row.sourceBadge,
    row.recordedByName,
    row.approvedByName,
    row.dailySheetId ? shortSheetId(row.dailySheetId) : null,
  ]
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .join('\n')
    .toLowerCase();
}

function matchesSearch(row: FilterableLedgerRow, q: string): boolean {
  if (searchHaystack(row).includes(q.toLowerCase())) return true;
  // A numeric search also hits an exact (whole-rupee) amount: "1500" / "1,500".
  const numeric = q.replace(/,/g, '');
  if (/^\d+$/.test(numeric)) return row.displayAmount === Number(numeric);
  return false;
}

/** True when at least one filter would narrow the timeline. Booleans only count when `true`; a too-short `q` is inactive. */
export function hasActiveFilters(filters: CashLedgerTimelineFilters | undefined): boolean {
  if (!filters) return false;
  return (
    normalizeSearch(filters.q) !== null ||
    present(filters.buckets) ||
    present(filters.status) ||
    !!filters.recordedFrom ||
    !!filters.recordedTo ||
    filters.backdatedOnly === true ||
    filters.editedOnly === true ||
    filters.hasAttachment === true ||
    filters.hasNote === true ||
    !!filters.recordedById ||
    !!filters.approvedById ||
    !!filters.employeeId ||
    present(filters.categories) ||
    typeof filters.minAmount === 'number' ||
    typeof filters.maxAmount === 'number' ||
    normalizeSheetPrefix(filters.sheet) !== null ||
    (filters.reference ?? '').trim().length > 0 ||
    !!filters.destination
  );
}

/** Does this row survive every active filter? (No active filter → always true.) */
export function matchesFilters(row: FilterableLedgerRow, filters: CashLedgerTimelineFilters | undefined): boolean {
  if (!filters) return true;

  if (present(filters.buckets) && !filters.buckets.includes(row.bucket)) return false;
  if (present(filters.status) && !matchesStatus(row, filters.status)) return false;

  if (filters.recordedFrom || filters.recordedTo) {
    const day = pktDay(row.createdAt);
    if (filters.recordedFrom && day < dayKey(filters.recordedFrom)) return false;
    if (filters.recordedTo && day > dayKey(filters.recordedTo)) return false;
  }

  if (filters.backdatedOnly === true && !((row.lagDays ?? 0) > 0)) return false;
  if (filters.editedOnly === true && !row.isEdited) return false;
  if (filters.hasAttachment === true && !row.hasAttachment) return false;
  if (filters.hasNote === true && !(typeof row.notes === 'string' && row.notes.trim().length > 0)) return false;

  if (filters.recordedById && row.recordedById !== filters.recordedById) return false;
  if (filters.approvedById && row.approvedById !== filters.approvedById) return false;
  if (filters.employeeId) {
    const own = row.employeeId === filters.employeeId;
    // Handover-family rows carry the submitting driver as `recordedById`.
    const driver = isHandoverFamily(row) && row.recordedById === filters.employeeId;
    if (!own && !driver) return false;
  }

  if (present(filters.categories) && !(row.category !== undefined && filters.categories.includes(row.category))) {
    return false;
  }

  if (typeof filters.minAmount === 'number' && row.displayAmount < filters.minAmount) return false;
  if (typeof filters.maxAmount === 'number' && row.displayAmount > filters.maxAmount) return false;

  const sheet = normalizeSheetPrefix(filters.sheet);
  if (sheet !== null && !(row.dailySheetId && shortSheetId(row.dailySheetId).startsWith(sheet))) return false;

  const reference = (filters.reference ?? '').trim().toLowerCase();
  if (reference && !(row.reference ?? '').toLowerCase().includes(reference)) return false;

  if (filters.destination && row.destination !== filters.destination) return false;

  const q = normalizeSearch(filters.q);
  if (q !== null && !matchesSearch(row, q)) return false;

  return true;
}

/** Count + cash-in / cash-out subtotal of the filtered rows (voided / pending rows are 0 in `amount` already). */
export function summarizeFiltered(
  rows: ReadonlyArray<Pick<FilterableLedgerRow, 'amount'>>,
): Pick<CashLedgerFilteredMeta, 'count' | 'totalIn' | 'totalOut'> {
  let totalIn = 0;
  let totalOut = 0;
  for (const row of rows) {
    if (row.amount > 0) totalIn += row.amount;
    else if (row.amount < 0) totalOut += -row.amount;
  }
  return { count: rows.length, totalIn: round2(totalIn), totalOut: round2(totalOut) };
}

// ── Query -> filters ─────────────────────────────────────────────────────────

/** The timeline query as it reaches the service (DTO shape, incl. the `key[]` aliases Express 5's simple parser leaves as-is). */
export type TimelineFilterQuery = CashLedgerTimelineFilters & {
  'buckets[]'?: string[];
  'status[]'?: string[];
  'categories[]'?: string[];
};

function mergeLists<T extends string>(...lists: Array<readonly T[] | undefined>): T[] | undefined {
  const merged = [...new Set(lists.flatMap((list) => list ?? []))];
  return merged.length > 0 ? merged : undefined;
}

/**
 * Extracts + normalises the P3 filters from a timeline query: merges the
 * `buckets[]`/`status[]`/`categories[]` aliases into their canonical keys and
 * rejects `minAmount > maxAmount` (400). Never mutates the query.
 */
export function resolveTimelineFilters(query: TimelineFilterQuery): CashLedgerTimelineFilters {
  const filters: CashLedgerTimelineFilters = {
    q: query.q,
    buckets: mergeLists(query.buckets, query['buckets[]'] as CashLedgerBucket[] | undefined),
    status: mergeLists(query.status, query['status[]'] as CashLedgerStatusFilter[] | undefined),
    recordedFrom: query.recordedFrom,
    recordedTo: query.recordedTo,
    backdatedOnly: query.backdatedOnly,
    editedOnly: query.editedOnly,
    recordedById: query.recordedById,
    approvedById: query.approvedById,
    employeeId: query.employeeId,
    categories: mergeLists(query.categories, query['categories[]']),
    minAmount: query.minAmount,
    maxAmount: query.maxAmount,
    hasAttachment: query.hasAttachment,
    hasNote: query.hasNote,
    sheet: query.sheet,
    reference: query.reference,
    destination: query.destination as CashLedgerRemittanceDestination | undefined,
  };
  if (
    typeof filters.minAmount === 'number' &&
    typeof filters.maxAmount === 'number' &&
    filters.minAmount > filters.maxAmount
  ) {
    throw new BadRequestException('minAmount cannot be greater than maxAmount.');
  }
  return filters;
}
