import { vendorDateString } from '../../common/helpers/date.util';
import type {
  CashLedgerHistoryAction,
  CashLedgerHistoryChange,
  CashLedgerHistoryChangeKind,
  CashLedgerHistoryEvent,
  ManualCashInSource,
} from './cash-ledger-contract';

/**
 * Cash Ledger P2 — pure helpers behind `GET /van-cash-ledger/entries/:type/:id/
 * history`. The history re-uses the generic `AuditLog` (no new store): this
 * module only NORMALISES whatever the various writers put in `changes`
 * (`{before, after, reason}` from P2 writers, plus the legacy shapes older
 * writers used) into `CashLedgerHistoryEvent`s. No I/O — the service does the
 * queries and hands the resolved van / user names in via `HistoryResolvers`.
 */

/** Labels for the manual cash-in `source` enum (mirrors the dashboard's MANUAL_CASH_IN_SOURCES). */
export const MANUAL_CASH_IN_SOURCE_LABELS: Record<ManualCashInSource, string> = {
  OWNER_INJECTION: 'Owner added cash',
  OPENING_BALANCE: 'Opening balance',
  REFUND: 'Refund',
  BANK_WITHDRAWAL: 'Bank withdrawal',
  OTHER: 'Other',
};

export function manualCashInSourceLabel(source: string | null | undefined): string | null {
  if (!source) return null;
  return MANUAL_CASH_IN_SOURCE_LABELS[source as ManualCashInSource] ?? null;
}

// ── Action normalisation ────────────────────────────────────────────────────

export function normalizeHistoryAction(raw: string | null | undefined): CashLedgerHistoryAction {
  switch ((raw ?? '').toUpperCase()) {
    case 'CREATE':
    case 'CREATED':
    case 'CLOSED_EXPENSE_ADDED':
      return 'CREATED';
    case 'UPDATE':
    case 'UPDATED':
    case 'EDITED':
      return 'UPDATED';
    case 'APPROVED':
      return 'APPROVED';
    case 'CORRECTED':
    case 'CLOSED_EXPENSE_CORRECTED':
      return 'CORRECTED';
    case 'VOIDED':
    case 'DELETED':
    case 'CLOSED_EXPENSE_VOIDED':
      return 'VOIDED';
    case 'REVERSED':
      return 'REVERSED';
    default:
      return 'OTHER';
  }
}

// ── Field metadata ──────────────────────────────────────────────────────────

interface FieldMeta {
  label: string;
  kind: CashLedgerHistoryChangeKind;
}

const money = (label: string): FieldMeta => ({ label, kind: 'money' });
const date = (label: string): FieldMeta => ({ label, kind: 'date' });
const text = (label: string): FieldMeta => ({ label, kind: 'text' });

const FIELD_META: Record<string, FieldMeta> = {
  amount: money('Amount'),
  openingBalance: money('Amount'),
  approvedAmount: money('Approved amount'),
  submittedAmount: money('Submitted amount'),
  expectedAmount: money('Expected amount'),
  total: money('Total'),
  delta: money('Adjustment'),
  date: date('Date'),
  openingDate: date('Date'),
  effectiveDate: date('Date'),
  note: text('Note'),
  notes: text('Note'),
  description: text('Description'),
  reference: text('Reference'),
  destinationName: text('Destination name'),
  destination: text('Destination'),
  status: { label: 'Status', kind: 'status' },
  vanId: text('Van'),
  employeeId: text('Employee'),
  category: text('Category'),
  source: text('Source'),
  paidFromCash: { label: 'Paid from cash', kind: 'boolean' },
  negativeOverrideReason: text('Negative override reason'),
  correctsEntryId: text('Corrects entry'),
  dailySheetId: text('Daily sheet'),
  fuelCardId: text('Fuel card'),
};

/** Keys that are the human reason (surfaced as `event.reason`, never as a change) or pure internals. */
const SKIPPED_KEYS = new Set([
  'reason',
  'voidReason',
  'adjustmentReason',
  'correctionReason',
  'correctionNote',
  'createdById',
  'updatedById',
  'seeded',
]);

function isTwinKey(key: string): boolean {
  return /^ledgerTwin/i.test(key) || key === 'staffLedgerEntryId';
}

function fieldMeta(key: string): FieldMeta {
  if (isTwinKey(key)) return text('Payroll entry');
  return FIELD_META[key] ?? text(humanizeKey(key));
}

function humanizeKey(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// ── Reason extraction ───────────────────────────────────────────────────────

type Json = Record<string, unknown>;

function asObject(value: unknown): Json {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {};
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/** `changes.reason` first (P2 convention), then the legacy per-writer keys. */
export function extractHistoryReason(changes: unknown): string | null {
  const c = asObject(changes);
  const before = asObject(c.before);
  const after = asObject(c.after);
  return (
    nonEmptyString(c.reason) ??
    nonEmptyString(after.reason) ??
    nonEmptyString(after.voidReason) ??
    nonEmptyString(after.adjustmentReason) ??
    nonEmptyString(after.correctionReason) ??
    nonEmptyString(after.correctionNote) ??
    nonEmptyString(before.correctionNote) ??
    null
  );
}

// ── Diff ────────────────────────────────────────────────────────────────────

/** Id -> display-name maps resolved (batched) by the service before the diff is built. */
export interface HistoryResolvers {
  vans: ReadonlyMap<string, string>;
  users: ReadonlyMap<string, string>;
}

export const EMPTY_RESOLVERS: HistoryResolvers = { vans: new Map(), users: new Map() };

/** The van / user ids referenced by an audit `changes` blob — for the batched name lookup. */
export function collectReferencedIds(changes: unknown): { vanIds: string[]; userIds: string[] } {
  const c = asObject(changes);
  const vanIds: string[] = [];
  const userIds: string[] = [];
  for (const side of [asObject(c.before), asObject(c.after)]) {
    if (typeof side.vanId === 'string' && side.vanId) vanIds.push(side.vanId);
    if (typeof side.employeeId === 'string' && side.employeeId) userIds.push(side.employeeId);
  }
  return { vanIds, userIds };
}

/** Old writers stored the pre/post chain TOTAL under different keys — fold them into one `total` pair. */
function normalizeLegacyShape(before: Json, after: Json): { before: Json; after: Json } {
  const b = { ...before };
  const a = { ...after };
  if ('currentTotal' in b) {
    b.total = b.currentTotal;
    delete b.currentTotal;
  }
  for (const key of ['newCashAmount', 'newAmount']) {
    if (key in a) {
      a.total = a[key];
      delete a[key];
    }
  }
  return { before: b, after: a };
}

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

function normalizeDate(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string' && DATE_ONLY_RE.test(value)) return value;
  const parsed = new Date(value as string | number | Date);
  return Number.isNaN(parsed.getTime()) ? String(value) : vendorDateString(parsed);
}

function shortId(value: unknown): string {
  return `#${String(value).slice(0, 8)}`;
}

function normalizeValue(
  key: string,
  kind: CashLedgerHistoryChangeKind,
  value: unknown,
  resolvers: HistoryResolvers,
): string | number | boolean | null {
  if (value === null || value === undefined) return null;

  if (isTwinKey(key) || key === 'correctsEntryId') return shortId(value);
  if (key === 'vanId') return resolvers.vans.get(String(value)) ?? String(value);
  if (key === 'employeeId') return resolvers.users.get(String(value)) ?? String(value);
  if (key === 'source') return manualCashInSourceLabel(String(value)) ?? String(value);

  switch (kind) {
    case 'money': {
      const n = typeof value === 'number' ? value : Number(value);
      return Number.isFinite(n) ? n : null;
    }
    case 'date':
      return normalizeDate(value);
    case 'boolean':
      return typeof value === 'boolean' ? value : value === 'true' ? true : value === 'false' ? false : null;
    default:
      if (typeof value === 'string') return value;
      if (typeof value === 'number' || typeof value === 'boolean') return String(value);
      return JSON.stringify(value);
  }
}

/**
 * Field-by-field diff of `before` / `after`: only keys present in either, and
 * only where the normalised values differ. Reason keys and internals are
 * skipped (they surface as `event.reason`).
 */
export function diffChanges(
  beforeRaw: unknown,
  afterRaw: unknown,
  resolvers: HistoryResolvers = EMPTY_RESOLVERS,
): CashLedgerHistoryChange[] {
  const { before, after } = normalizeLegacyShape(asObject(beforeRaw), asObject(afterRaw));
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => !SKIPPED_KEYS.has(k));

  const changes: CashLedgerHistoryChange[] = [];
  for (const field of keys) {
    const meta = fieldMeta(field);
    const b = normalizeValue(field, meta.kind, before[field], resolvers);
    const a = normalizeValue(field, meta.kind, after[field], resolvers);
    if (b === a) continue;
    changes.push({ field, label: meta.label, before: b, after: a, kind: meta.kind });
  }
  return changes;
}

// ── Summary ─────────────────────────────────────────────────────────────────

function formatMoney(n: number): string {
  const sign = n < 0 ? '-' : '';
  return `${sign}₨${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

function formatValue(kind: CashLedgerHistoryChangeKind, value: string | number | boolean | null): string {
  if (value === null || value === undefined || value === '') return '—';
  if (kind === 'money' && typeof value === 'number') return formatMoney(value);
  if (kind === 'boolean') return value ? 'Yes' : 'No';
  const s = String(value);
  return s.length > 40 ? `${s.slice(0, 37)}...` : s;
}

/** "Amount changed ₨10,000 → ₨12,000" — the first two material changes, the rest folded into "(+N more)". */
function describeChanges(changes: CashLedgerHistoryChange[]): string | null {
  // The payroll-twin pointer changes on every crew-cash edit — bookkeeping, not a headline.
  const material = changes.filter((c) => !isTwinKey(c.field));
  if (material.length === 0) return null;
  const parts = material
    .slice(0, 2)
    .map((c) => `${c.label} changed ${formatValue(c.kind, c.before)} → ${formatValue(c.kind, c.after)}`);
  const more = material.length - 2;
  return more > 0 ? `${parts.join('; ')} (+${more} more)` : parts.join('; ');
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function summarizeHistoryEvent(input: {
  rawAction: string;
  action: CashLedgerHistoryAction;
  reason: string | null;
  changes: CashLedgerHistoryChange[];
  before: Json;
  after: Json;
}): string {
  const { rawAction, action, reason, changes, before, after } = input;
  switch (action) {
    case 'CREATED':
      return 'Created';
    case 'UPDATED':
      return describeChanges(changes) ?? 'Updated';
    case 'VOIDED': {
      const verb = rawAction.toUpperCase() === 'DELETED' ? 'Deleted' : 'Voided';
      return reason ? `${verb} — ${reason}` : verb;
    }
    case 'APPROVED': {
      const from = numberOrNull(before.amount) ?? numberOrNull(before.submittedAmount);
      const to = numberOrNull(after.approvedAmount) ?? numberOrNull(after.amount);
      if (from !== null && to !== null && from !== to) {
        return `Approved (adjusted ${formatMoney(from)} → ${formatMoney(to)})`;
      }
      return 'Approved';
    }
    case 'CORRECTED': {
      const delta = numberOrNull(after.delta);
      if (delta !== null) return `Corrected by ${formatMoney(delta)}`;
      const described = describeChanges(changes);
      return described ? `Corrected — ${described}` : 'Corrected';
    }
    case 'REVERSED':
      return reason ? `Reversed — ${reason}` : 'Reversed';
    default: {
      const words = rawAction.toLowerCase().replace(/_/g, ' ').trim();
      return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Updated';
    }
  }
}

// ── Event builders ──────────────────────────────────────────────────────────

/** The audit-shaped input both AuditLog rows and StaffLedgerAuditLog rows are mapped onto. */
export interface AuditEventInput {
  id: string;
  rawAction: string;
  at: Date;
  actorName: string | null;
  /** The full `changes` JSON (`{before, after, reason}`) — or an equivalent object built from another audit table. */
  changes: unknown;
  source: 'AUDIT_LOG' | 'STAFF_LEDGER_AUDIT';
}

export function buildHistoryEvent(input: AuditEventInput, resolvers: HistoryResolvers): CashLedgerHistoryEvent {
  const action = normalizeHistoryAction(input.rawAction);
  const c = asObject(input.changes);
  const beforeRaw = asObject(c.before);
  const afterRaw = asObject(c.after);
  const reason = extractHistoryReason(input.changes);
  const changes = diffChanges(beforeRaw, afterRaw, resolvers);

  return {
    id: input.id,
    action,
    at: input.at.toISOString(),
    actorName: input.actorName,
    reason,
    summary: summarizeHistoryEvent({
      rawAction: input.rawAction,
      action,
      reason,
      changes,
      before: beforeRaw,
      after: afterRaw,
    }),
    changes,
    source: input.source,
  };
}

/** The synthesised CREATED event for a record that has no CREATED audit row of its own. */
export function buildRecordCreatedEvent(input: {
  id: string;
  at: Date;
  actorName: string | null;
  label?: string;
}): CashLedgerHistoryEvent {
  return {
    id: `record:${input.id}`,
    action: 'CREATED',
    at: input.at.toISOString(),
    actorName: input.actorName,
    reason: null,
    summary: input.label ?? 'Created',
    changes: [],
    source: 'RECORD',
  };
}

/** Newest first; on a tie the CREATED event is the oldest (last). */
export function sortHistoryEvents(events: CashLedgerHistoryEvent[]): CashLedgerHistoryEvent[] {
  return events
    .map((event, index) => ({ event, index }))
    .sort((x, y) => {
      const diff = Date.parse(y.event.at) - Date.parse(x.event.at);
      if (diff !== 0) return diff;
      const xc = x.event.action === 'CREATED' ? 1 : 0;
      const yc = y.event.action === 'CREATED' ? 1 : 0;
      if (xc !== yc) return xc - yc;
      return x.index - y.index;
    })
    .map(({ event }) => event);
}
