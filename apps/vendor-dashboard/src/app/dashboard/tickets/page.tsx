'use client';

import { Suspense, useState } from 'react';
import { MessageCircle } from 'lucide-react';
import { Badge } from '@water-supply-crm/ui';
import { Button } from '@water-supply-crm/ui';
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
  LOW:    'bg-muted text-muted-foreground',
  NORMAL: 'bg-blue-500/10 text-blue-600',
  HIGH:   'bg-amber-500/10 text-amber-600',
  URGENT: 'bg-destructive/10 text-destructive',
};

const TYPE_COLOR: Record<string, string> = {
  COMPLAINT: 'bg-destructive/10 text-destructive',
  FEEDBACK:  'bg-emerald-500/10 text-emerald-600',
};

function TicketsContent() {
  const { data, isLoading, page, setPage, limit, setLimit, type, setType, status, setStatus, priority, setPriority } = useTickets();
  const { mutate: replyTicket, isPending: isReplying } = useReplyTicket();
  const [selectedTicket, setSelectedTicket] = useState<any>(null);

  const rows = (data as any)?.data ?? [];
  const total = (data as any)?.meta?.total ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Support Tickets"
        description="Review complaints and feedback from customers."
      />

      {/* Filters */}
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
          <select
            value={status}
            onChange={(e) => { setStatus(e.target.value || null); setPage(1); }}
            className="rounded-xl border border-border bg-background px-3 py-2 text-xs font-bold focus:outline-none focus:ring-2 focus:ring-primary/50"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <select
            value={priority}
            onChange={(e) => { setPriority(e.target.value || null); setPage(1); }}
            className="rounded-xl border border-border bg-background px-3 py-2 text-xs font-bold focus:outline-none focus:ring-2 focus:ring-primary/50"
          >
            {PRIORITY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap gap-3 items-center">
          <SearchInput
            placeholder="Search subject, description, or customer…"
            onBeforeChange={() => setPage(1)}
          />
          <DateRangePicker className="w-[220px]" />
        </div>
      </div>

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
