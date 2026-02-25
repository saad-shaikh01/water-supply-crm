'use client';

import { Suspense, useState } from 'react';
import { MessageCircle, Plus, ChevronLeft, ChevronRight, AlertTriangle, ThumbsUp } from 'lucide-react';
import { Card, CardContent, Badge, Button } from '@water-supply-crm/ui';
import { parseAsInteger, parseAsString, useQueryState } from 'nuqs';
import { cn } from '@water-supply-crm/ui';
import { useTickets } from '../../../features/tickets/hooks/use-tickets';
import { CreateTicketDialog } from '../../../features/tickets/components/create-ticket-dialog';
import { TicketDetailDialog } from '../../../features/tickets/components/ticket-detail-dialog';

const STATUS_COLOR: Record<string, string> = {
  OPEN:        'bg-amber-500/10 text-amber-600',
  IN_PROGRESS: 'bg-blue-500/10 text-blue-600',
  RESOLVED:    'bg-emerald-500/10 text-emerald-600',
  CLOSED:      'bg-muted text-muted-foreground',
};

const PRIORITY_COLOR: Record<string, string> = {
  LOW:    'bg-muted text-muted-foreground',
  NORMAL: 'bg-blue-500/10 text-blue-600',
  HIGH:   'bg-amber-500/10 text-amber-600',
  URGENT: 'bg-destructive/10 text-destructive',
};

const TYPE_TABS = [
  { value: '', label: 'All' },
  { value: 'COMPLAINT', label: 'Complaints' },
  { value: 'FEEDBACK', label: 'Feedback' },
];

function SupportContent() {
  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1));
  const [typeFilter, setTypeFilter] = useQueryState('type', parseAsString.withDefault(''));
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<any>(null);

  const { data, isLoading } = useTickets({
    page,
    limit: 20,
    type: typeFilter || undefined,
  });

  const tickets = (data as any)?.data ?? [];
  const meta = (data as any)?.meta;
  const totalPages = meta ? Math.ceil(meta.total / 20) : 1;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
            <MessageCircle className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tight">Support</h1>
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
              {meta?.total ?? 0} tickets
            </p>
          </div>
        </div>
        <Button
          onClick={() => setCreateOpen(true)}
          className="rounded-2xl font-bold gap-2 shadow-lg shadow-primary/20 active:scale-95 transition-all"
        >
          <Plus className="h-4 w-4" />
          New Ticket
        </Button>
      </div>

      {/* Type filter tabs */}
      <div className="flex gap-2">
        {TYPE_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => { setTypeFilter(tab.value || null); setPage(1); }}
            className={cn(
              'px-4 py-2 rounded-xl text-xs font-bold transition-all',
              typeFilter === tab.value
                ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20'
                : 'bg-accent/50 text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* List */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 rounded-2xl bg-accent/30 animate-pulse" />
          ))}
        </div>
      ) : tickets.length === 0 ? (
        <Card className="bg-card/50">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <MessageCircle className="h-12 w-12 text-muted-foreground/30 mb-4" />
            <p className="font-bold text-muted-foreground">No tickets yet</p>
            <p className="text-sm text-muted-foreground/60 mt-1">Submit a complaint or feedback and we'll respond</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {tickets.map((ticket: any) => (
            <button
              key={ticket.id}
              onClick={() => setSelectedTicket(ticket)}
              className="w-full text-left"
            >
              <Card className="bg-card/50 backdrop-blur-sm border-border/50 hover:border-primary/30 hover:bg-card/80 transition-all">
                <CardContent className="p-4 flex items-start gap-4">
                  <div className={cn(
                    'h-10 w-10 rounded-xl flex items-center justify-center shrink-0 mt-0.5',
                    ticket.type === 'COMPLAINT' ? 'bg-destructive/10 text-destructive' : 'bg-emerald-500/10 text-emerald-600',
                  )}>
                    {ticket.type === 'COMPLAINT'
                      ? <AlertTriangle className="h-5 w-5" />
                      : <ThumbsUp className="h-5 w-5" />
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-sm truncate">{ticket.subject}</span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                      <Badge className={cn('text-[10px] px-2 py-0 rounded-full border-none font-bold', STATUS_COLOR[ticket.status] ?? '')}>
                        {ticket.status.replace('_', ' ')}
                      </Badge>
                      <Badge className={cn('text-[10px] px-2 py-0 rounded-full border-none font-bold', PRIORITY_COLOR[ticket.priority] ?? '')}>
                        {ticket.priority}
                      </Badge>
                      <span className="text-[11px] text-muted-foreground">
                        {new Date(ticket.createdAt).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </span>
                    </div>
                  </div>
                  {ticket.vendorReply && (
                    <div className="shrink-0">
                      <span className="text-[10px] font-bold text-emerald-600 bg-emerald-500/10 px-2 py-1 rounded-lg">Reply</span>
                    </div>
                  )}
                </CardContent>
              </Card>
            </button>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-4 pt-2">
          <Button
            variant="outline"
            size="sm"
            className="rounded-xl gap-1"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            <ChevronLeft className="h-4 w-4" /> Prev
          </Button>
          <span className="text-sm font-bold text-muted-foreground">{page} / {totalPages}</span>
          <Button
            variant="outline"
            size="sm"
            className="rounded-xl gap-1"
            disabled={page >= totalPages}
            onClick={() => setPage(page + 1)}
          >
            Next <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      <CreateTicketDialog open={createOpen} onOpenChange={setCreateOpen} />
      <TicketDetailDialog
        ticket={selectedTicket}
        open={!!selectedTicket}
        onOpenChange={(v) => { if (!v) setSelectedTicket(null); }}
      />
    </div>
  );
}

export default function SupportPage() {
  return (
    <Suspense fallback={<div className="h-64 rounded-2xl bg-accent/30 animate-pulse" />}>
      <SupportContent />
    </Suspense>
  );
}
