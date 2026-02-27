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
  // Delivery issue states
  PLANNED: { label: 'Planned', variant: 'warning' },
  IN_RETRY: { label: 'In Retry', variant: 'info' },
  RESOLVED: { label: 'Resolved', variant: 'success' },
  DROPPED: { label: 'Dropped', variant: 'secondary' },
  // Order states
  APPROVED: { label: 'Approved', variant: 'success' },
  REJECTED: { label: 'Rejected', variant: 'destructive' },
  UNDER_REVIEW: { label: 'Under Review', variant: 'warning' },
  DISPATCHED: { label: 'Dispatched', variant: 'info' },
  DELIVERED: { label: 'Delivered', variant: 'success' },
  UNPLANNED: { label: 'Unplanned', variant: 'outline' },
  INSERTED_IN_SHEET: { label: 'Inserted In Sheet', variant: 'info' },
  FAILED: { label: 'Failed', variant: 'destructive' },
  SELF_PICKUP_DONE: { label: 'Self Pickup', variant: 'success' },
};

export function StatusBadge({ status }: { status: Status }) {
  const config = statusConfig[status] ?? { label: status, variant: 'outline' as const };
  return <Badge variant={config.variant}>{config.label}</Badge>;
}
