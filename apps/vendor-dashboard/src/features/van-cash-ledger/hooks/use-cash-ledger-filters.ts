import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  useQueryStates,
  parseAsString,
  parseAsArrayOf,
  parseAsBoolean,
  parseAsFloat,
  parseAsStringLiteral,
} from 'nuqs';
import type {
  CashLedgerBucket,
  CashLedgerStatusFilter,
  CashLedgerTimelineFilters,
  RemittanceDestination,
} from '../api/van-cash-ledger.api';
import { CASH_LEDGER_BUCKET_META } from '../constants';
import { money } from '../format';
import { formatYmdShort } from '../../../lib/date-pkt';
import { usersApi } from '../../users/api/users.api';
import { domainMeta } from '../../expense-center/constants';
import { CREATABLE_LEDGER_CATEGORIES, LEDGER_CATEGORY_CONFIG } from '../../payroll/constants';
import { CREW_CASH_CATEGORIES, CREW_CASH_CATEGORY_CONFIG } from '../../crew-cash/constants';

/**
 * Cash Ledger P3 entry filters — URL state (nuqs), one short param per filter:
 *
 *   q        search text (≥ 2 chars, trimmed)      buckets  comma list of CashLedgerBucket
 *   status   comma list PENDING|APPROVED|VOIDED|CORRECTED
 *   rFrom/rTo recorded window (PKT YYYY-MM-DD)     backdated / edited  `true`
 *   recBy / apprBy / emp   user ids                cats     comma list of row categories
 *   min / max amount range                         att / note  `true`
 *   sheet    sheet number prefix                   ref      reference text
 *   dest     OWNER|CEO|BANK|OTHER
 *
 * They live beside — and never touch — `from, to, vanId, view, entry`. Filters
 * never change running balances or day statements (server folds first, filters
 * after), so they only ever affect the TIMELINE rows.
 */

const BUCKET_VALUES = [
  'SHEET_CASH_IN', 'OFFICE_CASH_IN', 'OFFICE_EXPENSE', 'PAYROLL_CASH', 'CREW_CASH', 'OWNER_TRANSFER', 'FUEL_CARD',
] as const satisfies readonly CashLedgerBucket[];
const STATUS_VALUES = ['PENDING', 'APPROVED', 'VOIDED', 'CORRECTED'] as const satisfies readonly CashLedgerStatusFilter[];
const DEST_VALUES = ['OWNER', 'CEO', 'BANK', 'OTHER'] as const satisfies readonly RemittanceDestination[];

/** Search text shorter than this is ignored by the server (and never written to the URL). */
export const CASH_LEDGER_MIN_SEARCH = 2;

const FILTER_PARSERS = {
  q: parseAsString,
  buckets: parseAsArrayOf(parseAsStringLiteral(BUCKET_VALUES)),
  status: parseAsArrayOf(parseAsStringLiteral(STATUS_VALUES)),
  rFrom: parseAsString,
  rTo: parseAsString,
  backdated: parseAsBoolean,
  edited: parseAsBoolean,
  recBy: parseAsString,
  apprBy: parseAsString,
  emp: parseAsString,
  cats: parseAsArrayOf(parseAsString),
  min: parseAsFloat,
  max: parseAsFloat,
  att: parseAsBoolean,
  note: parseAsBoolean,
  sheet: parseAsString,
  ref: parseAsString,
  dest: parseAsStringLiteral(DEST_VALUES),
};

type UrlKey = keyof typeof FILTER_PARSERS;

/** API filter key → short URL param. */
const KEY_MAP: Record<keyof CashLedgerTimelineFilters, UrlKey> = {
  q: 'q',
  buckets: 'buckets',
  status: 'status',
  recordedFrom: 'rFrom',
  recordedTo: 'rTo',
  backdatedOnly: 'backdated',
  editedOnly: 'edited',
  recordedById: 'recBy',
  approvedById: 'apprBy',
  employeeId: 'emp',
  categories: 'cats',
  minAmount: 'min',
  maxAmount: 'max',
  hasAttachment: 'att',
  hasNote: 'note',
  sheet: 'sheet',
  reference: 'ref',
  destination: 'dest',
};
const FILTER_KEYS = Object.keys(KEY_MAP) as Array<keyof CashLedgerTimelineFilters>;

const YMD = /^\d{4}-\d{2}-\d{2}$/;

// ── Shared option catalogues (used by the toolbar, the drawer and the chips) ──

/** Flow chips (row 2): Transfers = Owner Transfer + Fuel Card. Colours come from CASH_LEDGER_BUCKET_META. */
export const CASH_LEDGER_FLOW_GROUPS: ReadonlyArray<{ key: string; label: string; buckets: readonly CashLedgerBucket[] }> = [
  { key: 'sheet-in', label: 'Sheet In', buckets: ['SHEET_CASH_IN'] },
  { key: 'office-in', label: 'Office In', buckets: ['OFFICE_CASH_IN'] },
  { key: 'expenses', label: 'Expenses', buckets: ['OFFICE_EXPENSE'] },
  { key: 'crew', label: 'Crew Cash', buckets: ['CREW_CASH'] },
  { key: 'payroll', label: 'Payroll', buckets: ['PAYROLL_CASH'] },
  { key: 'transfers', label: 'Transfers', buckets: ['OWNER_TRANSFER', 'FUEL_CARD'] },
];

export const CASH_LEDGER_STATUS_OPTIONS: ReadonlyArray<{ value: CashLedgerStatusFilter; label: string }> = [
  { value: 'PENDING', label: 'Pending' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'VOIDED', label: 'Voided' },
  { value: 'CORRECTED', label: 'Corrected' },
];

export const CASH_LEDGER_DESTINATION_OPTIONS: ReadonlyArray<{ value: RemittanceDestination; label: string }> = [
  { value: 'OWNER', label: 'Owner' },
  { value: 'CEO', label: 'CEO' },
  { value: 'BANK', label: 'Bank' },
  { value: 'OTHER', label: 'Other' },
];

export interface CashLedgerCategoryGroup {
  key: string;
  label: string;
  options: ReadonlyArray<{ value: string; label: string }>;
}

/**
 * Row `category` values, grouped by domain. Expense categories mirror the
 * backend's `EXPENSE_CATEGORY_LABELS` / `EXPENSE_CATEGORY_DOMAINS`; Payroll and
 * Crew Cash labels come from their own feature constants. `OTHER` exists in both
 * the expense and crew-cash enums — it is listed once (Office) and matches both.
 */
export const CASH_LEDGER_CATEGORY_GROUPS: readonly CashLedgerCategoryGroup[] = [
  {
    key: 'VEHICLE',
    label: domainMeta('VEHICLE').label,
    options: [
      { value: 'FUEL_EXPENSE', label: 'Fuel' },
      { value: 'VEHICLE_MAINTENANCE', label: 'Vehicle Maintenance' },
      { value: 'POLICE', label: 'Police' },
      { value: 'VEHICLE_RENT', label: 'Vehicle Rent' },
    ],
  },
  {
    key: 'EMPLOYEES',
    label: domainMeta('EMPLOYEES').label,
    options: [
      { value: 'EXTRA_LABOUR', label: 'Extra Labour' },
      { value: 'CONTRACTOR_PAYMENT', label: 'Contractor Payment' },
      { value: 'LUNCH_EXPENSE_EMPLOYEE', label: 'Lunch (legacy)' },
      { value: 'ADVANCE_SALARY_EMPLOYEE', label: 'Salary Advance (legacy)' },
    ],
  },
  {
    key: 'OFFICE',
    label: domainMeta('OFFICE').label,
    options: [
      { value: 'RENT', label: 'Rent' },
      { value: 'UTILITIES', label: 'Utilities' },
      { value: 'STATIONARY', label: 'Stationary' },
      { value: 'MOBILE_LOAD', label: 'Mobile Load (EasyLoad)' },
      { value: 'PSQCA', label: 'PSQCA' },
      { value: 'CHARITY', label: 'Sadqa / Charity' },
      { value: 'OTHER', label: 'Other / Miscellaneous' },
    ],
  },
  {
    key: 'INVENTORY',
    label: domainMeta('INVENTORY').label,
    options: [
      { value: 'ICE_PURCHASED', label: 'Ice Purchase' },
      { value: 'BOTTLE_PURCHASED', label: 'Bottle Purchase' },
      { value: 'BOTTLE_REFILL_PAYMENT', label: 'Bottle Refill (Plant Payment)' },
      { value: 'CAPS_PURCHASED', label: 'Caps Purchase' },
      { value: 'CHEMICALS_PURCHASED', label: 'Chemicals Purchase' },
      { value: 'BOTTLE_REPAIR', label: 'Bottle Repair' },
    ],
  },
  {
    key: 'DISCREPANCY',
    label: domainMeta('DISCREPANCY').label,
    options: [{ value: 'DISCREPANCY_WRITE_OFF', label: 'Discrepancy Write-off' }],
  },
  {
    key: 'PAYROLL',
    label: 'Payroll',
    options: CREATABLE_LEDGER_CATEGORIES.map((c) => ({ value: c, label: LEDGER_CATEGORY_CONFIG[c].label })),
  },
  {
    key: 'CREW_CASH',
    label: 'Crew Cash',
    options: CREW_CASH_CATEGORIES.filter((c) => c !== 'OTHER').map((c) => ({
      value: c,
      label: CREW_CASH_CATEGORY_CONFIG[c].label,
    })),
  },
];

const CATEGORY_LABELS = new Map<string, string>(
  CASH_LEDGER_CATEGORY_GROUPS.flatMap((g) => g.options.map((o) => [o.value, o.label] as const)),
);
/** Readable label for a category value (falls back to a prettified enum name for unknown values). */
export const cashLedgerCategoryLabel = (value: string): string =>
  CATEGORY_LABELS.get(value) ??
  value.toLowerCase().replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

// ── State <-> filters ────────────────────────────────────────────────────────

type FilterState = { [K in UrlKey]: ReturnType<(typeof FILTER_PARSERS)[K]['parse']> };

function nonEmpty(value: string | null | undefined): string | undefined {
  const v = value?.trim();
  return v ? v : undefined;
}

function stateToFilters(s: FilterState): CashLedgerTimelineFilters {
  const f: CashLedgerTimelineFilters = {};
  const q = nonEmpty(s.q);
  if (q && q.length >= CASH_LEDGER_MIN_SEARCH) f.q = q;
  if (s.buckets?.length) f.buckets = [...s.buckets];
  if (s.status?.length) f.status = [...s.status];
  if (s.rFrom && YMD.test(s.rFrom)) f.recordedFrom = s.rFrom;
  if (s.rTo && YMD.test(s.rTo)) f.recordedTo = s.rTo;
  if (s.backdated === true) f.backdatedOnly = true;
  if (s.edited === true) f.editedOnly = true;
  const recBy = nonEmpty(s.recBy); if (recBy) f.recordedById = recBy;
  const apprBy = nonEmpty(s.apprBy); if (apprBy) f.approvedById = apprBy;
  const emp = nonEmpty(s.emp); if (emp) f.employeeId = emp;
  if (s.cats?.length) f.categories = [...s.cats];
  if (typeof s.min === 'number' && Number.isFinite(s.min) && s.min >= 0) f.minAmount = s.min;
  if (typeof s.max === 'number' && Number.isFinite(s.max) && s.max >= 0) f.maxAmount = s.max;
  if (s.att === true) f.hasAttachment = true;
  if (s.note === true) f.hasNote = true;
  const sheet = nonEmpty(s.sheet)?.replace(/^#/, ''); if (sheet) f.sheet = sheet;
  const ref = nonEmpty(s.ref); if (ref) f.reference = ref;
  if (s.dest) f.destination = s.dest;
  return f;
}

/** Empty value → `null` so nuqs removes the param (no `?edited=false`, no `?cats=`). */
function toUrlValue(value: unknown): unknown {
  if (value === undefined || value === null || value === false) return null;
  if (typeof value === 'string') return value.trim() === '' ? null : value.trim();
  if (Array.isArray(value)) return value.length === 0 ? null : value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  return value;
}

export interface CashLedgerFilterChip {
  /** Stable key (also used to hide a chip in a given surface). */
  key: string;
  label: string;
  onRemove: () => void;
}

const EMPTY_PATCH: CashLedgerTimelineFilters = Object.fromEntries(
  FILTER_KEYS.map((k) => [k, undefined]),
) as CashLedgerTimelineFilters;

/** Truncates a list of labels: "A, B" or "A, B +2". */
const joinLabels = (labels: string[], max = 2): string =>
  labels.length <= max ? labels.join(', ') : `${labels.slice(0, max).join(', ')} +${labels.length - max}`;

function useUserNames(enabled: boolean): Map<string, string> {
  // Same key as `useCrewCandidates` (features/users/hooks) so the list is shared with the drawer's pickers.
  const { data } = useQuery({
    queryKey: ['users', 'crew-candidates'],
    queryFn: () => usersApi.getAll({ limit: 100, isActive: true }).then((r) => r.data as { data?: Array<{ id: string; name: string }> }),
    enabled,
    staleTime: 5 * 60 * 1000,
  });
  return useMemo(() => new Map((data?.data ?? []).map((u) => [u.id, u.name])), [data]);
}

export interface UseCashLedgerFilters {
  /** Ready to spread into the API params: empty values omitted, `q` only when ≥ 2 chars. */
  filters: CashLedgerTimelineFilters;
  /** Merge a patch. A key present with `undefined`/''/false/[] CLEARS that filter; absent keys are untouched. */
  setFilters: (patch: CashLedgerTimelineFilters) => void;
  /** Replace the whole entry-filter set in one URL update (unlisted filters are cleared). */
  replaceFilters: (next: CashLedgerTimelineFilters) => void;
  /** Clears every ENTRY filter (incl. search + flow chips). Never touches from/to/vanId/view. */
  clearFilters: () => void;
  /** Active filter GROUPS, excluding date/van/view and the search text (flow chips included). */
  activeCount: number;
  /** Same as `activeCount` minus the flow chips — i.e. the groups editable in the Filters drawer (trigger badge). */
  drawerCount: number;
  hasSearch: boolean;
  hasBuckets: boolean;
  /** Any entry filter at all (search and flow chips included). */
  anyActive: boolean;
  chips: CashLedgerFilterChip[];
}

export function useCashLedgerFilters(): UseCashLedgerFilters {
  const [state, setState] = useQueryStates(FILTER_PARSERS, {
    history: 'replace',
    scroll: false,
  });

  const stateKey = JSON.stringify(state);
  // Keyed on the serialised state: nuqs hands back fresh array instances, this keeps `filters` referentially stable.
  const filters = useMemo(() => stateToFilters(state as FilterState), [stateKey]);

  const setFilters = useCallback(
    (patch: CashLedgerTimelineFilters) => {
      const urlPatch: Record<string, unknown> = {};
      for (const key of FILTER_KEYS) {
        if (!(key in patch)) continue;
        let value: unknown = patch[key];
        // Sheet numbers are shown as `#A1B2…` — store them without the hash.
        if (key === 'sheet' && typeof value === 'string') value = value.replace(/^\s*#/, '');
        urlPatch[KEY_MAP[key]] = toUrlValue(value);
      }
      // nuqs' typed setter wants per-parser value types; the patch is normalised above.
      void setState(urlPatch as never);
    },
    [setState],
  );

  const replaceFilters = useCallback(
    (next: CashLedgerTimelineFilters) => setFilters({ ...EMPTY_PATCH, ...next }),
    [setFilters],
  );
  const clearFilters = useCallback(() => setFilters(EMPTY_PATCH), [setFilters]);

  const hasSearch = !!filters.q;
  const hasBuckets = !!filters.buckets?.length;

  const groups = {
    status: !!filters.status?.length,
    recorded: !!(filters.recordedFrom || filters.recordedTo),
    backdated: !!filters.backdatedOnly,
    edited: !!filters.editedOnly,
    recordedBy: !!filters.recordedById,
    approvedBy: !!filters.approvedById,
    employee: !!filters.employeeId,
    categories: !!filters.categories?.length,
    amount: filters.minAmount !== undefined || filters.maxAmount !== undefined,
    attachment: !!filters.hasAttachment,
    note: !!filters.hasNote,
    sheet: !!filters.sheet,
    reference: !!filters.reference,
    destination: !!filters.destination,
  };
  const drawerCount = Object.values(groups).filter(Boolean).length;
  const activeCount = drawerCount + (hasBuckets ? 1 : 0);

  const needsNames = !!(filters.recordedById || filters.approvedById || filters.employeeId);
  const names = useUserNames(needsNames);
  const personLabel = (id: string) => names.get(id) ?? 'Selected user';

  const chips: CashLedgerFilterChip[] = [];
  const add = (key: string, label: string, clear: CashLedgerTimelineFilters) =>
    chips.push({ key, label, onRemove: () => setFilters(clear) });

  if (filters.q) add('q', `Search: “${filters.q}”`, { q: undefined });
  if (filters.buckets?.length) {
    add('buckets', `Flow: ${joinLabels(filters.buckets.map((b) => CASH_LEDGER_BUCKET_META[b]?.label ?? b))}`, { buckets: undefined });
  }
  if (filters.status?.length) {
    const label = (v: CashLedgerStatusFilter) => CASH_LEDGER_STATUS_OPTIONS.find((o) => o.value === v)?.label ?? v;
    add('status', `Status: ${joinLabels(filters.status.map(label), 4)}`, { status: undefined });
  }
  if (groups.recorded) {
    const a = filters.recordedFrom ? formatYmdShort(filters.recordedFrom) : null;
    const b = filters.recordedTo ? formatYmdShort(filters.recordedTo) : null;
    const text = a && b ? (a === b ? a : `${a} → ${b}`) : a ? `from ${a}` : `until ${b}`;
    add('recorded', `Recorded: ${text}`, { recordedFrom: undefined, recordedTo: undefined });
  }
  if (groups.backdated) add('backdated', 'Backdated only', { backdatedOnly: undefined });
  if (groups.edited) add('edited', 'Edited only', { editedOnly: undefined });
  if (filters.recordedById) add('recordedBy', `Recorded by: ${personLabel(filters.recordedById)}`, { recordedById: undefined });
  if (filters.approvedById) add('approvedBy', `Approved by: ${personLabel(filters.approvedById)}`, { approvedById: undefined });
  if (filters.employeeId) add('employee', `Employee: ${personLabel(filters.employeeId)}`, { employeeId: undefined });
  if (filters.categories?.length) {
    add('categories', `Category: ${joinLabels(filters.categories.map(cashLedgerCategoryLabel))}`, { categories: undefined });
  }
  if (groups.amount) {
    const { minAmount: lo, maxAmount: hi } = filters;
    const text = lo !== undefined && hi !== undefined ? `${money(lo)} – ${money(hi)}` : lo !== undefined ? `≥ ${money(lo)}` : `≤ ${money(hi)}`;
    add('amount', `Amount: ${text}`, { minAmount: undefined, maxAmount: undefined });
  }
  if (filters.hasAttachment) add('attachment', 'Has attachment', { hasAttachment: undefined });
  if (filters.hasNote) add('note', 'Has note', { hasNote: undefined });
  if (filters.sheet) add('sheet', `Sheet #${filters.sheet.toUpperCase()}`, { sheet: undefined });
  if (filters.reference) add('reference', `Ref: ${filters.reference}`, { reference: undefined });
  if (filters.destination) {
    const label = CASH_LEDGER_DESTINATION_OPTIONS.find((o) => o.value === filters.destination)?.label ?? filters.destination;
    add('destination', `Transfer to: ${label}`, { destination: undefined });
  }

  return {
    filters,
    setFilters,
    replaceFilters,
    clearFilters,
    activeCount,
    drawerCount,
    hasSearch,
    hasBuckets,
    anyActive: activeCount > 0 || hasSearch,
    chips,
  };
}
