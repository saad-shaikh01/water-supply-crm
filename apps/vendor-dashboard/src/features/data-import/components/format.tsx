import { Badge } from '@water-supply-crm/ui';
import type { ImportBatchStatus, ImportRowAction, ImportRowResult } from '../api/data-import.api';

export const rupees = (v: number) => `₨ ${v.toLocaleString('en-PK', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
export const rupeesFromPaise = (p: number) => rupees(p / 100);

export function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline' | 'primary' | 'success' | 'warning' | 'info';

const STATUS: Record<ImportBatchStatus, { label: string; variant: BadgeVariant }> = {
  UPLOADED: { label: 'Draft — needs mapping', variant: 'secondary' },
  MAPPED: { label: 'Ready to review', variant: 'info' },
  QUEUED: { label: 'Queued', variant: 'info' },
  EXECUTING: { label: 'Importing…', variant: 'info' },
  COMPLETED: { label: 'Completed', variant: 'success' },
  COMPLETED_WITH_ERRORS: { label: 'Completed with errors', variant: 'warning' },
  FAILED: { label: 'Interrupted', variant: 'destructive' },
  CANCELLED: { label: 'Cancelled', variant: 'outline' },
  REVERTED: { label: 'Reverted', variant: 'outline' },
  PARTIALLY_REVERTED: { label: 'Partly reverted', variant: 'warning' },
};

export function ImportStatusBadge({ status }: { status: ImportBatchStatus }) {
  const s = STATUS[status];
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

export const isDraft = (s: ImportBatchStatus) => s === 'UPLOADED' || s === 'MAPPED';
export const isFinished = (s: ImportBatchStatus) =>
  s === 'COMPLETED' || s === 'COMPLETED_WITH_ERRORS' || s === 'REVERTED' || s === 'PARTIALLY_REVERTED';

const ACTION: Record<ImportRowAction, { label: string; variant: BadgeVariant }> = {
  CREATE: { label: 'Will create', variant: 'success' },
  UPDATE: { label: 'Will update', variant: 'info' },
  SKIP_EXISTING: { label: 'Already exists', variant: 'secondary' },
  SKIP_INVALID: { label: 'Has errors', variant: 'destructive' },
};

const RESULT: Partial<Record<ImportRowResult, { label: string; variant: BadgeVariant }>> = {
  CREATED: { label: 'Created', variant: 'success' },
  SKIPPED: { label: 'Skipped', variant: 'secondary' },
  FAILED: { label: 'Failed', variant: 'destructive' },
  REVERTED: { label: 'Reverted', variant: 'outline' },
  REVERT_SKIPPED: { label: 'Created (kept)', variant: 'warning' },
};

/** Planned outcome before the run, actual outcome after. */
export function RowOutcomeBadge({ action, result }: { action: ImportRowAction | null; result: ImportRowResult }) {
  const done = RESULT[result];
  if (done) return <Badge variant={done.variant}>{done.label}</Badge>;
  if (!action) return <Badge variant="outline">—</Badge>;
  const a = ACTION[action];
  return <Badge variant={a.variant}>{a.label}</Badge>;
}

/** User-facing wording for server error codes where the raw message is not enough. */
export const BLOCK_REASON_LABEL: Record<string, string> = {
  HAS_ACTIVITY: 'Already used (deliveries, payments, orders…)',
  BALANCE_CHANGED: 'Balance changed after the import',
  PORTAL_LINKED: 'Customer activated a portal login',
  ALREADY_GONE: 'No longer exists',
};
