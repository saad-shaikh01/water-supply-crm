'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight, History, MessageSquare } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, Button, Input, Label, Badge, cn } from '@water-supply-crm/ui';
import { PageHeader } from '../../../components/shared/page-header';
import { useNotificationLogs } from '../../../features/notification-logs/hooks/use-notification-logs';

const TYPE_LABELS: Record<string, string> = {
  DELIVERY_RECEIPT: 'Delivery Receipt',
  MONTHLY_STATEMENT: 'Statement / Balance Reminder',
  PAYMENT_RECEIVED: 'Payment Received',
  ORDER_UPDATE: 'Order Update',
  TICKET_REPLY: 'Ticket Reply',
};

const STATUS_STYLES: Record<string, string> = {
  SENT: 'bg-emerald-500/10 text-emerald-400',
  FAILED: 'bg-destructive/10 text-destructive',
  SKIPPED: 'bg-amber-500/10 text-amber-400',
};

const CHANNELS = ['WHATSAPP', 'SMS', 'FCM', 'IN_APP'] as const;

export default function NotificationLogsPage() {
  const [page, setPage] = useState(1);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [channel, setChannel] = useState<string>('WHATSAPP');
  const [status, setStatus] = useState<'all' | 'SENT' | 'FAILED' | 'SKIPPED'>('all');
  const [search, setSearch] = useState('');

  const { data, isLoading } = useNotificationLogs(page, 20, {
    channel: channel === 'all' ? undefined : channel,
    status: status === 'all' ? undefined : status,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    search: search || undefined,
  });

  const logs: any[] = (data as any)?.data ?? [];
  const meta = (data as any)?.meta;
  const hasFilters = !!(dateFrom || dateTo || status !== 'all' || search);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Notification Logs"
        description="Every WhatsApp / SMS / push send attempt — sent, failed, or skipped by a vendor setting"
      />

      <Card className="bg-card/50 backdrop-blur-sm border-border/50 overflow-hidden">
        <CardHeader className="pb-3 border-b border-border/50 bg-white/5">
          <CardTitle className="text-sm font-bold flex items-center gap-2 uppercase tracking-widest text-muted-foreground">
            <History className="h-4 w-4 text-primary" />
            Send History
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          {/* Filters */}
          <div className="flex flex-wrap items-end gap-3 mb-4">
            <div className="space-y-1">
              <Label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground ml-1">From</Label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
                className="h-8 rounded-lg border border-border/50 bg-accent/30 px-2 text-xs text-foreground dark:text-white font-mono focus:outline-none focus:ring-1 focus:ring-primary/50"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground ml-1">To</Label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
                className="h-8 rounded-lg border border-border/50 bg-accent/30 px-2 text-xs text-foreground dark:text-white font-mono focus:outline-none focus:ring-1 focus:ring-primary/50"
              />
            </div>
            <div className="flex gap-1.5">
              {(['all', ...CHANNELS] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => { setChannel(c); setPage(1); }}
                  className={cn(
                    'px-2.5 h-8 rounded-lg text-xs font-bold border transition-colors',
                    channel === c
                      ? 'bg-primary/15 border-primary/40 text-primary'
                      : 'bg-white/5 border-white/10 text-muted-foreground hover:bg-white/10',
                  )}
                >
                  {c === 'all' ? 'All Channels' : c}
                </button>
              ))}
            </div>
            <div className="flex gap-1.5">
              {(['all', 'SENT', 'FAILED', 'SKIPPED'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => { setStatus(s); setPage(1); }}
                  className={cn(
                    'px-2.5 h-8 rounded-lg text-xs font-bold border transition-colors',
                    status === s
                      ? 'bg-primary/15 border-primary/40 text-primary'
                      : 'bg-white/5 border-white/10 text-muted-foreground hover:bg-white/10',
                  )}
                >
                  {s === 'all' ? 'All' : s.charAt(0) + s.slice(1).toLowerCase()}
                </button>
              ))}
            </div>
            <Input
              placeholder="Search phone…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="bg-accent/30 border-border/50 h-8 rounded-lg text-xs w-40"
            />
            {hasFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setDateFrom(''); setDateTo(''); setStatus('all'); setSearch(''); setPage(1); }}
                className="h-8 px-2 rounded-lg text-xs text-muted-foreground"
              >
                Clear
              </Button>
            )}
          </div>

          {isLoading ? (
            <div className="space-y-2">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-10 rounded-xl bg-accent/30 animate-pulse" />
              ))}
            </div>
          ) : logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center space-y-2">
              <MessageSquare className="h-8 w-8 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">
                {hasFilters ? 'No sends match these filters.' : 'No notifications logged yet.'}
              </p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground border-b border-border/30">
                      <th className="text-left pb-2 pr-4">Date</th>
                      <th className="text-left pb-2 pr-4">Type</th>
                      <th className="text-left pb-2 pr-4">Recipient</th>
                      <th className="text-left pb-2 pr-4">Channel</th>
                      <th className="text-left pb-2 pr-4">Status</th>
                      <th className="text-left pb-2">Error</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/20">
                    {logs.map((log) => (
                      <tr key={log.id} className="hover:bg-white/5 transition-colors">
                        <td className="py-2.5 pr-4 text-muted-foreground whitespace-nowrap">
                          {new Date(log.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="py-2.5 pr-4 text-foreground dark:text-white">
                          {TYPE_LABELS[log.eventType] ?? log.eventType ?? '—'}
                        </td>
                        <td className="py-2.5 pr-4 font-mono text-foreground dark:text-white whitespace-nowrap">
                          {log.recipientAddress ?? '—'}
                        </td>
                        <td className="py-2.5 pr-4 text-muted-foreground">{log.channel}</td>
                        <td className="py-2.5 pr-4">
                          <Badge className={cn('text-[9px] font-black px-1.5 border-none', STATUS_STYLES[log.status] ?? 'bg-white/10 text-muted-foreground')}>
                            {log.status}
                          </Badge>
                        </td>
                        <td className="py-2.5 text-muted-foreground max-w-xs truncate" title={log.lastError ?? ''}>
                          {log.lastError ?? '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {meta?.totalPages > 1 && (
                <div className="flex items-center justify-between mt-4 pt-3 border-t border-border/30">
                  <span className="text-[10px] text-muted-foreground">
                    Page {meta.page} of {meta.totalPages} · {meta.total} total
                  </span>
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 rounded-lg text-xs"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => p - 1)}
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 rounded-lg text-xs"
                      disabled={page >= meta.totalPages}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
