'use client';

import { Suspense, useState } from 'react';
import { MessageCircle, SlidersHorizontal, X } from 'lucide-react';
import {
  Badge,
  Button,
  Label,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@water-supply-crm/ui';
import { cn } from '@water-supply-crm/ui';
import { PageHeader } from '../../../components/shared/page-header';
import { DataTable } from '../../../components/shared/data-table';
import { StatusBadge } from '../../../components/shared/status-badge';
import { SearchInput } from '../../../components/shared/filters/search-input';
import { DateRangePicker } from '../../../components/shared/date-range-picker';
import { useTickets, useReplyTicket } from '../../../features/tickets/hooks/use-tickets';
import { TicketReplyDialog } from '../../../features/tickets/components/ticket-reply-dialog';

const TYPE_TABS = [
  { value: '', label: 'All' },
  { value: 'COMPLAINT', label: 'Complaints' },
  { value: 'FEEDBACK', label: 'Feedback' },
];

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'OPEN', label: 'Open' },
  { value: 'IN_PROGRESS', label: 'In Progress' },
  { value: 'RESOLVED', label: 'Resolved' },
  { value: 'CLOSED', label: 'Closed' },
];

const PRIORITY_OPTIONS = [
  { value: '', label: 'All Priorities' },
  { value: 'LOW', label: 'Low' },
  { value: 'NORMAL', label: 'Normal' },
  { value: 'HIGH', label: 'High' },
  { value: 'URGENT', label: 'Urgent' },
];

const PRIORITY_COLOR: Record<string, string> = {
  LOW: 'bg-muted text-muted-foreground',
  NORMAL: 'bg-blue-500/10 text-blue-600',
  HIGH: 'bg-amber-500/10 text-amber-600',
  URGENT: 'bg-destructive/10 text-destructive',
};

const TYPE_COLOR: Record<string, string> = {
  COMPLAINT: 'bg-destructive/10 text-destructive',
  FEEDBACK: 'bg-emerald-500/10 text-emerald-600',
};

function TicketsContent() {
  const {
    data,
    isLoading,
    page,
    setPage,
    limit,
    setLimit,
    type,
    setType,
    status,
    setStatus,
    priority,
    setPriority,
    search,
    setSearch,
    from,
    setFrom,
    to,
    setTo,
  } = useTickets();
  const { mutate: replyTicket, isPending: isReplying } = useReplyTicket();
  const [selectedTicket, setSelectedTicket] = useState<any>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const rows = (data as any)?.data ?? [];
  const total = (data as any)?.meta?.total ?? 0;
  const statusLabel = STATUS_OPTIONS.find((opt) => opt.value === status)?.label;
  const priorityLabel = PRIORITY_OPTIONS.find((opt) => opt.value === priority)?.label;

  const formatDateLabel = (date: string) =>
    new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

  const activeChips = [
    type ? { label: `Type: ${type}`, clear: () => { setPage(1); setType(null); } } : null,
    status ? { label: `Status: ${statusLabel}`, clear: () => { setPage(1); setStatus(null); } } : null,
    priority ? { label: `Priority: ${priorityLabel}`, clear: () => { setPage(1); setPriority(null); } } : null,
    search ? { label: `Search: ${search}`, clear: () => { setPage(1); setSearch(null); } } : null,
    (from || to)
      ? {
          label: `Date: ${from ? formatDateLabel(from) : '...'} to ${to ? formatDateLabel(to) : '...'}`,
          clear: () => { setPage(1); setFrom(null); setTo(null); },
        }
      : null,
  ].filter(Boolean) as Array<{ label: string; clear: () => void }>;

  const clearAll = () => {
    setPage(1);
    setType(null);
    setStatus(null);
    setPriority(null);
    setSearch(null);
    setFrom(null);
    setTo(null);
  };

  const activeFilterCount = [status, priority, from || to].filter(Boolean).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Support Tickets"
        description="Review complaints and feedback from customers."
      />

      <div className="space-y-3">
        <div className="flex flex-wrap gap-3 items-center">
          <div className="flex gap-1">
            {TYPE_TABS.map((tab) => (
              <button
                key={tab.value}
                onClick={() => { setType(tab.value || null); setPage(1); }}
                className={cn(
                  'px-4 py-2 rounded-xl text-xs font-bold transition-all border',
                  type === tab.value
                    ? 'bg-primary text-primary-foreground border-transparent shadow-lg shadow-primary/20'
                    : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <SearchInput
            placeholder="Search subject, description, or customer..."
            onBeforeChange={() => setPage(1)}
          />

          <Button
            variant="outline"
            size="sm"
            onClick={() => setFiltersOpen(true)}
            className={cn(
              'rounded-xl h-10 px-4 gap-2 font-semibold shrink-0',
              activeFilterCount > 0 && 'border-primary text-primary',
            )}
          >
            <SlidersHorizontal className="h-4 w-4" />
            More Filters
            {activeFilterCount > 0 && (
              <span className="h-5 w-5 flex items-center justify-center rounded-full bg-primary text-primary-foreground text-[10px] font-black">
                {activeFilterCount}
              </span>
            )}
          </Button>
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
            <button
              onClick={clearAll}
              className="text-xs text-muted-foreground hover:text-foreground font-semibold underline-offset-2 hover:underline"
            >
              Clear all
            </button>
          </div>
        )}
      </div>

      <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
        <SheetContent side="right" className="w-full sm:max-w-sm bg-background/95 backdrop-blur-xl border-l border-border/50">
          <SheetHeader className="pb-6 border-b">
            <SheetTitle className="flex items-center gap-2 text-lg font-bold">
              <SlidersHorizontal className="h-5 w-5 text-primary" /> More Filters
            </SheetTitle>
          </SheetHeader>
          <div className="space-y-6 py-6">
            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Status</Label>
              <select
                value={status}
                onChange={(e) => { setStatus(e.target.value || null); setPage(1); }}
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                {STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Priority</Label>
              <select
                value={priority}
                onChange={(e) => { setPriority(e.target.value || null); setPage(1); }}
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                {PRIORITY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Date Range</Label>
              <DateRangePicker className="w-full" />
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <DataTable
        data={rows}
        isLoading={isLoading}
        page={page}
        limit={limit}
        total={total}
        onPageChange={setPage}
        onLimitChange={setLimit}
        emptyMessage="No tickets found."
        columns={[
          {
            key: 'date',
            header: 'Date',
            cell: (r: any) => (
              <span className="text-xs text-muted-foreground">
                {new Date(r.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
              </span>
            ),
          },
          {
            key: 'customer',
            header: 'Customer',
            cell: (r: any) => (
              <p className="font-bold text-sm">{r.customer?.name}</p>
            ),
          },
          {
            key: 'type',
            header: 'Type',
            cell: (r: any) => (
              <Badge className={cn('text-[10px] px-2 py-0 rounded-full border-none font-bold', TYPE_COLOR[r.type] ?? '')}>
                {r.type}
              </Badge>
            ),
          },
          {
            key: 'priority',
            header: 'Priority',
            cell: (r: any) => (
              <Badge className={cn('text-[10px] px-2 py-0 rounded-full border-none font-bold', PRIORITY_COLOR[r.priority] ?? '')}>
                {r.priority}
              </Badge>
            ),
          },
          {
            key: 'subject',
            header: 'Subject',
            cell: (r: any) => (
              <p className="text-sm font-medium truncate max-w-48">{r.subject}</p>
            ),
          },
          {
            key: 'status',
            header: 'Status',
            cell: (r: any) => <StatusBadge status={r.status} />,
          },
          {
            key: 'actions',
            header: '',
            width: '80px',
            cell: (r: any) =>
              r.status !== 'CLOSED' ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-xl h-8 text-xs font-bold gap-1.5"
                  onClick={() => setSelectedTicket(r)}
                >
                  <MessageCircle className="h-3.5 w-3.5" />
                  Reply
                </Button>
              ) : null,
          },
        ]}
      />

      <TicketReplyDialog
        ticket={selectedTicket}
        open={!!selectedTicket}
        onOpenChange={(v) => { if (!v) setSelectedTicket(null); }}
        isPending={isReplying}
        onConfirm={({ vendorReply, status: newStatus }) => {
          if (selectedTicket) {
            replyTicket({ id: selectedTicket.id, vendorReply, status: newStatus }, {
              onSuccess: () => setSelectedTicket(null),
            });
          }
        }}
      />
    </div>
  );
}

export default function TicketsPage() {
  return (
    <Suspense fallback={<div className="h-64 rounded-2xl bg-accent/30 animate-pulse" />}>
      <TicketsContent />
    </Suspense>
  );
}
