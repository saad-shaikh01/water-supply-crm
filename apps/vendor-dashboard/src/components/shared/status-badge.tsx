import { Badge } from '@water-supply-crm/ui';

type Status = 'OPEN' | 'CLOSED' | 'PENDING' | 'ACTIVE' | 'INACTIVE' | 'IN_PROGRESS' | 'GENERATED' | 'LOADED' | 'DELIVERING' | 'CHECKED_IN' | string;

const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning' | 'info' }> = {
  OPEN: { label: 'Open', variant: 'outline' },
  ACTIVE: { label: 'Active', variant: 'success' },
  CLOSED: { label: 'Closed', variant: 'secondary' },
  INACTIVE: { label: 'Inactive', variant: 'secondary' },
  PENDING: { label: 'Pending', variant: 'warning' },
  IN_PROGRESS: { label: 'In Progress', variant: 'info' },
  GENERATED: { label: 'Generated', variant: 'info' },
  LOADED: { label: 'Loaded Out', variant: 'warning' },
  DELIVERING: { label: 'Delivering', variant: 'info' },
  CHECKED_IN: { label: 'Checked In', variant: 'success' },
  COMPLETED: { label: 'Completed', variant: 'success' },
  CANCELLED: { label: 'Cancelled', variant: 'destructive' },
  RESCHEDULED: { label: 'Rescheduled', variant: 'warning' },
  NOT_AVAILABLE: { label: 'Not Available', variant: 'destructive' },
  EMPTY_ONLY: { label: 'Empty Only', variant: 'info' },
};

export function StatusBadge({ status }: { status: Status }) {
  const config = statusConfig[status] ?? { label: status, variant: 'outline' as const };
  return <Badge variant={config.variant}>{config.label}</Badge>;
}
