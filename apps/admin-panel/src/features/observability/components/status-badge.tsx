import { Badge } from '@water-supply-crm/ui';

type Variant = 'default' | 'secondary' | 'destructive' | 'outline' | 'primary' | 'success' | 'warning' | 'info';

const MAP: Record<string, Variant> = {
  up: 'success',
  ok: 'success',
  down: 'destructive',
  unknown: 'secondary',
  COMPLETED: 'success',
  COMPLETED_WITH_ERRORS: 'warning',
  FAILED: 'destructive',
  CANCELLED: 'secondary',
  REVERTED: 'secondary',
  PARTIALLY_REVERTED: 'warning',
  QUEUED: 'info',
  EXECUTING: 'info',
  PLANNING: 'info',
  MAPPED: 'primary',
  UPLOADED: 'outline',
  CREATE: 'success',
  UPDATE: 'info',
  DELETE: 'destructive',
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return (
    <Badge variant={MAP[status] ?? 'outline'} data-status={status}>
      {label ?? status.replace(/_/g, ' ')}
    </Badge>
  );
}
