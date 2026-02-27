'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@water-supply-crm/ui';
import { AlertTriangle, CheckCircle2, Clock3, X } from 'lucide-react';
import { DataTable } from '../../../components/shared/data-table';
import { DateRangePicker } from '../../../components/shared/date-range-picker';
import { StatusBadge } from '../../../components/shared/status-badge';
import {
  useDeliveryIssues,
  usePlanDeliveryIssue,
  useResolveDeliveryIssue,
} from '../hooks/use-delivery-issues';
import { useAllVans } from '../../vans/hooks/use-vans';
import { useAllDrivers } from '../../users/hooks/use-users';
import { usersApi } from '../../users/api/users.api';

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'OPEN', label: 'Open' },
  { value: 'PLANNED', label: 'Planned' },
  { value: 'IN_RETRY', label: 'In Retry' },
  { value: 'RESOLVED', label: 'Resolved' },
  { value: 'DROPPED', label: 'Dropped' },
];

const NEXT_ACTION_OPTIONS = [
  { value: 'RETRY_SAME_DAY', label: 'Retry Same Day' },
  { value: 'RETRY_ON_DATE_TIME', label: 'Retry On Date/Time' },
  { value: 'MOVE_TO_NEXT_REGULAR_DAY', label: 'Move To Next Regular Day' },
  { value: 'SELF_PICKUP', label: 'Self Pickup' },
  { value: 'CANCEL_ONE_OFF', label: 'Cancel One-Off' },
  { value: 'PERMANENT_STOP', label: 'Permanent Stop' },
];

const RESOLUTION_OPTIONS = [
  { value: 'DELIVERED', label: 'Delivered' },
  { value: 'SELF_PICKUP_DONE', label: 'Self Pickup Done' },
  { value: 'DROPPED', label: 'Dropped' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

interface DeliveryIssueRow {
  id: string;
  status: string;
  nextAction?: string;
  retryAt?: string;
  assignedToUserId?: string;
  assignedVanId?: string;
  assignedDriverId?: string;
  planNotes?: string;
  resolution?: string;
  resolvedNotes?: string;
  resolvedAt?: string;
  createdAt: string;
  updatedAt: string;
  dailySheetItem?: {
    id: string;
    sequence: number;
    status: string;
    failureCategory?: string;
    reason?: string;
    customer?: { id: string; name: string; customerCode: string; address: string };
    product?: { id: string; name: string };
    dailySheet?: {
      id: string;
      date: string;
      route?: { id: string; name: string };
      van?: { id: string; plateNumber: string };
      driver?: { id: string; name: string };
    };
  };
}

const toLocalDateTimeValue = (iso?: string) => {
  if (!iso) return '';
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

export function DeliveryIssuesInbox() {
  const {
    data,
    isLoading,
    page,
    setPage,
    limit,
    setLimit,
    status,
    setStatus,
    assignedToUserId,
    setAssignedToUserId,
    from,
    setFrom,
    to,
    setTo,
  } = useDeliveryIssues();

  const { mutate: planIssue, isPending: isPlanning } = usePlanDeliveryIssue();
  const { mutate: resolveIssue, isPending: isResolving } = useResolveDeliveryIssue();

  const { data: staffData } = useQuery({
    queryKey: ['delivery-issues', 'staff-options'],
    queryFn: () => usersApi.getAll({ limit: 100, role: 'STAFF', isActive: true }).then((r) => r.data),
  });
  const { data: vansData } = useAllVans();
  const { data: driversData } = useAllDrivers();

  const rows = ((data as any)?.data ?? []) as DeliveryIssueRow[];
  const total = (data as any)?.meta?.total ?? 0;

  const staff = ((staffData as any)?.data ?? []) as Array<{ id: string; name: string }>;
  const vans = ((vansData as any)?.data ?? []) as Array<{ id: string; plateNumber: string }>;
  const drivers = ((driversData as any)?.data ?? []) as Array<{ id: string; name: string }>;

  const staffById = useMemo(() => new Map(staff.map((user) => [user.id, user.name])), [staff]);

  const [planTarget, setPlanTarget] = useState<DeliveryIssueRow | null>(null);
  const [planForm, setPlanForm] = useState({
    nextAction: 'RETRY_SAME_DAY',
    retryAt: '',
    assignedToUserId: '',
    assignedVanId: '',
    assignedDriverId: '',
    notes: '',
  });

  const [resolveTarget, setResolveTarget] = useState<DeliveryIssueRow | null>(null);
  const [resolveForm, setResolveForm] = useState({
    resolution: 'DELIVERED',
    notes: '',
  });

  const openPlan = (issue: DeliveryIssueRow) => {
    setPlanTarget(issue);
    setPlanForm({
      nextAction: issue.nextAction || 'RETRY_SAME_DAY',
      retryAt: toLocalDateTimeValue(issue.retryAt),
      assignedToUserId: issue.assignedToUserId || '',
      assignedVanId: issue.assignedVanId || '',
      assignedDriverId: issue.assignedDriverId || '',
      notes: issue.planNotes || '',
    });
  };

  const openResolve = (issue: DeliveryIssueRow) => {
    setResolveTarget(issue);
    setResolveForm({
      resolution: issue.resolution || 'DELIVERED',
      notes: issue.resolvedNotes || '',
    });
  };

  const formatDateTime = (date: string) =>
    new Date(date).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  const getSlaMeta = (createdAt: string) => {
    const ageHours = Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 3600000));

    if (ageHours >= 48) {
      return { label: `${Math.floor(ageHours / 24)}d`, className: 'bg-destructive/10 text-destructive' };
    }
    if (ageHours >= 24) {
      return { label: `${Math.floor(ageHours / 24)}d`, className: 'bg-amber-500/10 text-amber-600' };
    }
    return { label: `${ageHours}h`, className: 'bg-emerald-500/10 text-emerald-600' };
  };

  const statusLabel = STATUS_OPTIONS.find((opt) => opt.value === status)?.label;
  const assigneeLabel = staffById.get(assignedToUserId) ?? 'Unassigned';

  const activeChips = [
    status ? { label: `Status: ${statusLabel}`, clear: () => { setPage(1); setStatus(null); } } : null,
    assignedToUserId ? { label: `Assignee: ${assigneeLabel}`, clear: () => { setPage(1); setAssignedToUserId(null); } } : null,
    (from || to)
      ? { label: `Date: ${from || '...'} to ${to || '...'}`, clear: () => { setPage(1); setFrom(null); setTo(null); } }
      : null,
  ].filter(Boolean) as Array<{ label: string; clear: () => void }>;

  const clearAll = () => {
    setPage(1);
    setStatus(null);
    setAssignedToUserId(null);
    setFrom(null);
    setTo(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 bg-card/30 p-4 rounded-2xl border border-border/50">
        <div className="space-y-1.5">
          <Label className="text-[10px] uppercase font-bold text-muted-foreground ml-1">Status</Label>
          <Select value={status || 'all'} onValueChange={(value) => { setPage(1); setStatus(value === 'all' ? null : value); }}>
            <SelectTrigger className="w-[170px] rounded-xl bg-background/50 border-border/50 h-10">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {STATUS_OPTIONS.filter((option) => option.value).map((option) => (
                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-[10px] uppercase font-bold text-muted-foreground ml-1">Assignee</Label>
          <Select
            value={assignedToUserId || 'all'}
            onValueChange={(value) => { setPage(1); setAssignedToUserId(value === 'all' ? null : value); }}
          >
            <SelectTrigger className="w-[200px] rounded-xl bg-background/50 border-border/50 h-10">
              <SelectValue placeholder="All Assignees" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Assignees</SelectItem>
              {staff.map((user) => (
                <SelectItem key={user.id} value={user.id}>{user.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-[10px] uppercase font-bold text-muted-foreground ml-1">Date Range</Label>
          <DateRangePicker className="w-[220px]" />
        </div>

        {activeChips.length > 0 && (
          <Button variant="ghost" size="sm" onClick={clearAll} className="h-10 font-semibold">
            Clear all
          </Button>
        )}
      </div>

      {activeChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-1">
          {activeChips.map((chip) => (
            <button
              key={chip.label}
              onClick={chip.clear}
              className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold hover:bg-primary/20 transition-colors"
            >
              {chip.label}
              <X className="h-3 w-3" />
            </button>
          ))}
        </div>
      )}

      <DataTable
        data={rows}
        isLoading={isLoading}
        page={page}
        limit={limit}
        total={total}
        onPageChange={setPage}
        onLimitChange={setLimit}
        emptyMessage="No delivery issues found."
        columns={[
          {
            key: 'reportedAt',
            header: 'Reported',
            cell: (row: DeliveryIssueRow) => (
              <div>
                <p className="text-xs font-semibold">{formatDateTime(row.createdAt)}</p>
                <p className="text-[10px] text-muted-foreground">#{row.dailySheetItem?.sequence}</p>
              </div>
            ),
          },
          {
            key: 'customer',
            header: 'Customer',
            cell: (row: DeliveryIssueRow) => (
              <div>
                <p className="text-sm font-bold">{row.dailySheetItem?.customer?.name}</p>
                <p className="text-[10px] text-muted-foreground">{row.dailySheetItem?.customer?.customerCode}</p>
              </div>
            ),
          },
          {
            key: 'context',
            header: 'Route / Van',
            cell: (row: DeliveryIssueRow) => (
              <div>
                <p className="text-xs font-semibold">{row.dailySheetItem?.dailySheet?.route?.name ?? '-'}</p>
                <p className="text-[10px] text-muted-foreground">{row.dailySheetItem?.dailySheet?.van?.plateNumber ?? '-'}</p>
              </div>
            ),
          },
          {
            key: 'issue',
            header: 'Issue',
            cell: (row: DeliveryIssueRow) => (
              <div>
                <p className="text-xs font-semibold">{row.dailySheetItem?.failureCategory ?? 'UNSPECIFIED'}</p>
                <p className="text-[10px] text-muted-foreground truncate max-w-56">{row.dailySheetItem?.reason ?? '-'}</p>
              </div>
            ),
          },
          {
            key: 'assignee',
            header: 'Assignee',
            cell: (row: DeliveryIssueRow) => (
              <span className="text-xs font-semibold">{staffById.get(row.assignedToUserId || '') ?? 'Unassigned'}</span>
            ),
          },
          {
            key: 'sla',
            header: 'SLA Aging',
            cell: (row: DeliveryIssueRow) => {
              const sla = getSlaMeta(row.createdAt);
              return (
                <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${sla.className}`}>
                  {sla.label}
                </span>
              );
            },
          },
          {
            key: 'status',
            header: 'Status',
            cell: (row: DeliveryIssueRow) => <StatusBadge status={row.status} />,
          },
          {
            key: 'actions',
            header: '',
            width: '180px',
            cell: (row: DeliveryIssueRow) => {
              const isClosed = row.status === 'RESOLVED' || row.status === 'DROPPED';
              return (
                <div className="flex items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 rounded-xl text-[11px] font-bold"
                    disabled={isClosed}
                    onClick={() => openPlan(row)}
                  >
                    <Clock3 className="h-3.5 w-3.5 mr-1" />
                    Plan
                  </Button>
                  <Button
                    size="sm"
                    className="h-8 rounded-xl text-[11px] font-bold"
                    disabled={isClosed}
                    onClick={() => openResolve(row)}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                    Resolve
                  </Button>
                </div>
              );
            },
          },
        ]}
      />

      <Dialog open={!!planTarget} onOpenChange={(open) => !open && setPlanTarget(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-black flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" /> Plan Delivery Issue
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-bold uppercase tracking-wider">Next Action</Label>
              <Select value={planForm.nextAction} onValueChange={(value) => setPlanForm((prev) => ({ ...prev, nextAction: value }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {NEXT_ACTION_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold uppercase tracking-wider">Retry At (optional)</Label>
              <Input
                type="datetime-local"
                value={planForm.retryAt}
                onChange={(event) => setPlanForm((prev) => ({ ...prev, retryAt: event.target.value }))}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold uppercase tracking-wider">Assignee</Label>
                <Select
                  value={planForm.assignedToUserId || 'none'}
                  onValueChange={(value) => setPlanForm((prev) => ({ ...prev, assignedToUserId: value === 'none' ? '' : value }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Unassigned" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Unassigned</SelectItem>
                    {staff.map((user) => (
                      <SelectItem key={user.id} value={user.id}>{user.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-bold uppercase tracking-wider">Van</Label>
                <Select
                  value={planForm.assignedVanId || 'none'}
                  onValueChange={(value) => setPlanForm((prev) => ({ ...prev, assignedVanId: value === 'none' ? '' : value }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Unassigned" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Unassigned</SelectItem>
                    {vans.map((van) => (
                      <SelectItem key={van.id} value={van.id}>{van.plateNumber}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-bold uppercase tracking-wider">Driver</Label>
                <Select
                  value={planForm.assignedDriverId || 'none'}
                  onValueChange={(value) => setPlanForm((prev) => ({ ...prev, assignedDriverId: value === 'none' ? '' : value }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Unassigned" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Unassigned</SelectItem>
                    {drivers.map((driver) => (
                      <SelectItem key={driver.id} value={driver.id}>{driver.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold uppercase tracking-wider">Plan Notes</Label>
              <Textarea
                rows={3}
                value={planForm.notes}
                onChange={(event) => setPlanForm((prev) => ({ ...prev, notes: event.target.value }))}
                placeholder="Plan details for ops handoff..."
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setPlanTarget(null)}>Cancel</Button>
            <Button
              disabled={isPlanning}
              onClick={() => {
                if (!planTarget) return;
                planIssue({
                  id: planTarget.id,
                  data: {
                    nextAction: planForm.nextAction,
                    retryAt: planForm.retryAt ? new Date(planForm.retryAt).toISOString() : undefined,
                    assignedToUserId: planForm.assignedToUserId || undefined,
                    assignedVanId: planForm.assignedVanId || undefined,
                    assignedDriverId: planForm.assignedDriverId || undefined,
                    notes: planForm.notes || undefined,
                  },
                }, {
                  onSuccess: () => setPlanTarget(null),
                });
              }}
            >
              Save Plan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!resolveTarget} onOpenChange={(open) => !open && setResolveTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-black flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-500" /> Resolve Delivery Issue
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-bold uppercase tracking-wider">Resolution</Label>
              <Select value={resolveForm.resolution} onValueChange={(value) => setResolveForm((prev) => ({ ...prev, resolution: value }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RESOLUTION_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold uppercase tracking-wider">Notes</Label>
              <Textarea
                rows={3}
                value={resolveForm.notes}
                onChange={(event) => setResolveForm((prev) => ({ ...prev, notes: event.target.value }))}
                placeholder="Resolution notes..."
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setResolveTarget(null)}>Cancel</Button>
            <Button
              disabled={isResolving}
              onClick={() => {
                if (!resolveTarget) return;
                resolveIssue({
                  id: resolveTarget.id,
                  data: {
                    resolution: resolveForm.resolution,
                    notes: resolveForm.notes || undefined,
                  },
                }, {
                  onSuccess: () => setResolveTarget(null),
                });
              }}
            >
              Confirm Resolve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
