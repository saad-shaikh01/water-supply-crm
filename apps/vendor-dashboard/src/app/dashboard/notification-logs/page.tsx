'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, ClipboardList, Filter, History, MessageSquare, RotateCw, X } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, Button, Input, Label, Badge, cn } from '@water-supply-crm/ui';
import { PageHeader } from '../../../components/shared/page-header';
import { useCan } from '../../../features/authz/hooks/use-can';
import { vansApi } from '../../../features/vans/api/vans.api';
import {
  useNotificationLogs,
  useNotificationLogSummary,
  useRetryNotificationLog,
} from '../../../features/notification-logs/hooks/use-notification-logs';

const TYPE_LABELS: Record<string, string> = {
  DELIVERY_RECEIPT: 'Delivery Receipt',
  MONTHLY_STATEMENT: 'Statement / Balance Reminder',
  PAYMENT_RECEIVED: 'Payment Received',
  ORDER_UPDATE: 'Order Update',
  TICKET_REPLY: 'Ticket Reply',
};

const ERROR_LABELS: Record<string, string> = {
  NOT_DELIVERED: 'Not delivered (number / WhatsApp / template)',
  API_ERROR: 'Other errors',
  DISABLED: 'Disabled in settings',
};

const STATUS_STYLES: Record<string, string> = {
  SENT: 'bg-emerald-500/10 text-emerald-400',
  FAILED: 'bg-destructive/10 text-destructive',
  SKIPPED: 'bg-amber-500/10 text-amber-400',
};

const CHANNELS = ['WHATSAPP', 'SMS', 'FCM', 'IN_APP'] as const;

const INPUT_CLASS =
  'h-8 rounded-lg border border-border/50 bg-accent/30 px-2 text-xs text-foreground dark:text-white focus:outline-none focus:ring-1 focus:ring-primary/50';

/** Local YYYY-MM-DD (not toISOString, which would shift the day in UTC+5). */
const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
};

const PRESETS: { label: string; range: () => [string, string] }[] = [
  { label: 'Today', range: () => [isoDay(new Date()), isoDay(new Date())] },
  { label: 'Yesterday', range: () => [isoDay(daysAgo(1)), isoDay(daysAgo(1))] },
  { label: 'Last 7 days', range: () => [isoDay(daysAgo(6)), isoDay(new Date())] },
  {
    label: 'This month',
    range: () => {
      const now = new Date();
      return [isoDay(new Date(now.getFullYear(), now.getMonth(), 1)), isoDay(now)];
    },
  },
];

const pillClass = (active: boolean) =>
  cn(
    'px-2.5 h-8 rounded-lg text-xs font-bold border transition-colors',
    active ? 'bg-primary/15 border-primary/40 text-primary' : 'bg-white/5 border-white/10 text-muted-foreground hover:bg-white/10',
  );

export default function NotificationLogsPage() {
  const [page, setPage] = useState(1);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sheetDate, setSheetDate] = useState('');
  const [channel, setChannel] = useState<string>('WHATSAPP');
  const [status, setStatus] = useState<'all' | 'SENT' | 'FAILED' | 'SKIPPED'>('all');
  const [search, setSearch] = useState('');
  const [eventType, setEventType] = useState('all');
  const [errorCategory, setErrorCategory] = useState('all');
  const [vanId, setVanId] = useState('all');
  const [dailySheetId, setDailySheetId] = useState('');
  const [customer, setCustomer] = useState<{ id: string; label: string } | null>(null);

  const canRetry = useCan('notifications:configure');
  const retry = useRetryNotificationLog();

  const { data: vansRes } = useQuery({
    queryKey: ['notification-logs-vans'],
    queryFn: () => vansApi.getAll({ limit: 100 }).then((r) => r.data),
    staleTime: 15 * 60 * 1000,
  });
  const vans: any[] = ((vansRes as any)?.data ?? (Array.isArray(vansRes) ? vansRes : [])).filter((v: any) => !v.isSystem);

  // Everything except status — the summary always shows the full Sent/Failed/Skipped split.
  const baseFilters = {
    channel: channel === 'all' ? undefined : channel,
    eventType: eventType === 'all' ? undefined : eventType,
    errorCategory: errorCategory === 'all' ? undefined : errorCategory,
    vanId: vanId === 'all' ? undefined : vanId,
    dailySheetId: dailySheetId || undefined,
    sheetDate: sheetDate || undefined,
    customerId: customer?.id,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    search: search || undefined,
  };
  const filters = { ...baseFilters, status: status === 'all' ? undefined : status };

  const { data, isLoading } = useNotificationLogs(page, 20, filters);
  const { data: summary } = useNotificationLogSummary(baseFilters);

  const logs: any[] = (data as any)?.data ?? [];
  const meta = (data as any)?.meta;
  const hasFilters = !!(
    dateFrom || dateTo || sheetDate || status !== 'all' || eventType !== 'all' || errorCategory !== 'all' ||
    vanId !== 'all' || dailySheetId || customer || search
  );

  const reset = () => {
    setDateFrom(''); setDateTo(''); setSheetDate(''); setStatus('all'); setEventType('all');
    setErrorCategory('all'); setVanId('all'); setDailySheetId(''); setCustomer(null); setSearch(''); setPage(1);
  };
  const change = <T,>(setter: (v: T) => void) => (v: T) => { setter(v); setPage(1); };

  const statCards: { key: 'all' | 'SENT' | 'FAILED' | 'SKIPPED'; label: string; value: number; tone: string }[] = [
    { key: 'all', label: 'Total', value: summary?.total ?? 0, tone: 'text-foreground dark:text-white' },
    { key: 'SENT', label: 'Sent', value: summary?.byStatus.SENT ?? 0, tone: 'text-emerald-400' },
    { key: 'FAILED', label: 'Failed', value: summary?.byStatus.FAILED ?? 0, tone: 'text-destructive' },
    { key: 'SKIPPED', label: 'Skipped', value: summary?.byStatus.SKIPPED ?? 0, tone: 'text-amber-400' },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        title="Notification Logs"
        description="Every WhatsApp / SMS / push send attempt — sent, failed, or skipped by a vendor setting"
      />

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {statCards.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => { setStatus(c.key); setPage(1); }}
            className={cn(
              'rounded-xl border p-3 text-left transition-colors bg-card/50',
              status === c.key ? 'border-primary/40 bg-primary/10' : 'border-border/50 hover:bg-white/5',
            )}
          >
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{c.label}</div>
            <div className={cn('text-2xl font-black mt-1', c.tone)}>{c.value}</div>
          </button>
        ))}
      </div>

      <Card className="bg-card/50 backdrop-blur-sm border-border/50 overflow-hidden">
        <CardHeader className="pb-3 border-b border-border/50 bg-white/5">
          <CardTitle className="text-sm font-bold flex items-center gap-2 uppercase tracking-widest text-muted-foreground">
            <History className="h-4 w-4 text-primary" />
            Send History
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          {/* Type breakdown + failure reasons */}
          {summary && (summary.byEventType.length > 0 || summary.byStatus.FAILED + summary.byStatus.SKIPPED > 0) && (
            <div className="space-y-2 mb-4">
              {summary.byEventType.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mr-1">By type</span>
                  {summary.byEventType.map((t) => (
                    <button
                      key={t.eventType ?? 'none'}
                      type="button"
                      disabled={!t.eventType}
                      onClick={() => { setEventType(t.eventType as string); setPage(1); }}
                      className={cn(pillClass(eventType === t.eventType), 'h-7 font-medium')}
                    >
                      {t.eventType ? TYPE_LABELS[t.eventType] ?? t.eventType : 'Unlabelled'} · {t.count}
                    </button>
                  ))}
                </div>
              )}
              {(['NOT_DELIVERED', 'API_ERROR', 'DISABLED'] as const).some((k) => summary.byErrorCategory[k] > 0) && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mr-1">Why they failed</span>
                  {(['NOT_DELIVERED', 'API_ERROR', 'DISABLED'] as const)
                    .filter((k) => summary.byErrorCategory[k] > 0)
                    .map((k) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => { setErrorCategory(errorCategory === k ? 'all' : k); setPage(1); }}
                        className={cn(pillClass(errorCategory === k), 'h-7 font-medium')}
                      >
                        {ERROR_LABELS[k]} · {summary.byErrorCategory[k]}
                      </button>
                    ))}
                </div>
              )}
            </div>
          )}

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-1.5 mb-3">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mr-1">Quick range</span>
            {PRESETS.map((p) => {
              const [from, to] = p.range();
              return (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => { setDateFrom(from); setDateTo(to); setPage(1); }}
                  className={pillClass(dateFrom === from && dateTo === to)}
                >
                  {p.label}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-end gap-3 mb-4">
            <div className="space-y-1">
              <Label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground ml-1">From</Label>
              <input type="date" value={dateFrom} onChange={(e) => change(setDateFrom)(e.target.value)} className={cn(INPUT_CLASS, 'font-mono')} />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground ml-1">To</Label>
              <input type="date" value={dateTo} onChange={(e) => change(setDateTo)(e.target.value)} className={cn(INPUT_CLASS, 'font-mono')} />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground ml-1">Delivery date</Label>
              <input type="date" value={sheetDate} onChange={(e) => change(setSheetDate)(e.target.value)} className={cn(INPUT_CLASS, 'font-mono')} />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground ml-1">Van</Label>
              <select value={vanId} onChange={(e) => change(setVanId)(e.target.value)} className={cn(INPUT_CLASS, 'block')}>
                <option value="all">All Vans</option>
                {vans.map((v) => (
                  <option key={v.id} value={v.id}>{v.plateNumber}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground ml-1">Type</Label>
              <select value={eventType} onChange={(e) => change(setEventType)(e.target.value)} className={cn(INPUT_CLASS, 'block')}>
                <option value="all">All Types</option>
                {Object.entries(TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground ml-1">Error</Label>
              <select value={errorCategory} onChange={(e) => change(setErrorCategory)(e.target.value)} className={cn(INPUT_CLASS, 'block')}>
                <option value="all">Any / none</option>
                {Object.entries(ERROR_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
            <Input
              placeholder="Search name, code or phone…"
              value={search}
              onChange={(e) => change(setSearch)(e.target.value)}
              className="bg-accent/30 border-border/50 h-8 rounded-lg text-xs w-56"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3 mb-4">
            <div className="flex gap-1.5">
              {(['all', ...CHANNELS] as const).map((c) => (
                <button key={c} type="button" onClick={() => change(setChannel)(c)} className={pillClass(channel === c)}>
                  {c === 'all' ? 'All Channels' : c}
                </button>
              ))}
            </div>
            <div className="flex gap-1.5">
              {(['all', 'SENT', 'FAILED', 'SKIPPED'] as const).map((s) => (
                <button key={s} type="button" onClick={() => change(setStatus)(s)} className={pillClass(status === s)}>
                  {s === 'all' ? 'All' : s.charAt(0) + s.slice(1).toLowerCase()}
                </button>
              ))}
            </div>
            {hasFilters && (
              <Button variant="ghost" size="sm" onClick={reset} className="h-8 px-2 rounded-lg text-xs text-muted-foreground">
                Clear
              </Button>
            )}
          </div>

          {(customer || dailySheetId) && (
            <div className="flex flex-wrap gap-2 mb-4">
              {customer && (
                <Badge className="gap-1 bg-primary/15 text-primary border-none text-[11px]">
                  Customer history: {customer.label}
                  <button type="button" onClick={() => change(setCustomer)(null)} aria-label="Remove customer filter">
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              )}
              {dailySheetId && (
                <Badge className="gap-1 bg-primary/15 text-primary border-none text-[11px]">
                  One daily sheet
                  <button type="button" onClick={() => change(setDailySheetId)('')} aria-label="Remove sheet filter">
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              )}
            </div>
          )}

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
                      <th className="text-left pb-2 pr-4">Customer</th>
                      <th className="text-left pb-2 pr-4">Recipient</th>
                      <th className="text-left pb-2 pr-4">Channel</th>
                      <th className="text-left pb-2 pr-4">Status</th>
                      <th className="text-left pb-2 pr-4">Error</th>
                      <th className="text-left pb-2 pr-4">Sheet</th>
                      <th className="text-left pb-2">Action</th>
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
                        <td className="py-2.5 pr-4 text-foreground dark:text-white whitespace-nowrap">
                          {log.customerName ? (
                            <button
                              type="button"
                              title="Show all messages for this customer"
                              onClick={() => {
                                setCustomer({ id: log.customerId, label: `${log.customerName}${log.customerCode ? ` (${log.customerCode})` : ''}` });
                                setChannel('all');
                                setPage(1);
                              }}
                              className="hover:text-primary hover:underline text-left"
                            >
                              {log.customerName}
                              {log.customerCode && <span className="ml-1 font-mono text-[10px] text-muted-foreground">({log.customerCode})</span>}
                            </button>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="py-2.5 pr-4 font-mono text-foreground dark:text-white whitespace-nowrap">
                          {log.recipientAddress ?? '—'}
                        </td>
                        <td className="py-2.5 pr-4 text-muted-foreground">{log.channel}</td>
                        <td className="py-2.5 pr-4">
                          <Badge className={cn('text-[9px] font-black px-1.5 border-none', STATUS_STYLES[log.status] ?? 'bg-white/10 text-muted-foreground')}>
                            {log.status}
                          </Badge>
                          {log.retriedAt && <span className="ml-1 text-[10px] text-muted-foreground">retried</span>}
                        </td>
                        <td className="py-2.5 pr-4 text-muted-foreground max-w-xs truncate" title={log.lastError ?? ''}>
                          {log.lastError ?? '—'}
                        </td>
                        <td className="py-2.5 pr-4">
                          {log.dailySheetId ? (
                            <span className="inline-flex items-center gap-2">
                              <Link
                                href={`/dashboard/daily-sheets/${log.dailySheetId}`}
                                className="inline-flex items-center gap-1 text-primary hover:underline font-bold"
                              >
                                <ClipboardList className="h-3 w-3" /> View
                              </Link>
                              <button
                                type="button"
                                title="Only show sends from this sheet"
                                onClick={() => change(setDailySheetId)(log.dailySheetId)}
                                className="text-muted-foreground hover:text-primary"
                              >
                                <Filter className="h-3 w-3" />
                              </button>
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="py-2.5">
                          {log.canRetry && canRetry ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={retry.isPending}
                              onClick={() => retry.mutate(log.id)}
                              className="h-7 px-2 rounded-lg text-xs text-primary"
                            >
                              <RotateCw className="h-3 w-3 mr-1" /> Retry
                            </Button>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
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
                    <Button variant="ghost" size="sm" className="h-7 px-2 rounded-lg text-xs" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 px-2 rounded-lg text-xs" disabled={page >= meta.totalPages} onClick={() => setPage((p) => p + 1)}>
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
