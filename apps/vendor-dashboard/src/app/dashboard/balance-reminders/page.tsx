'use client';

import { useState, useEffect } from 'react';
import {
  Send, Users, CheckCircle2, Loader2,
  User, FileText, ChevronRight, AlertCircle, Info, Wifi, WifiOff, Zap, History,
  ChevronLeft, Download, AlertTriangle, Settings2,
} from 'lucide-react';
import {
  Card, CardContent, CardHeader, CardTitle, Button, Input, Label,
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  Badge, Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@water-supply-crm/ui';
import { PageHeader } from '../../../components/shared/page-header';
import {
  useSendTargeted,
  usePreviewReminders,
  useWhatsAppStatus,
  useReminderHistory,
  useReminderHistoryDetail,
  useReminderConfig,
  useUpdateReminderConfig,
} from '../../../features/balance-reminders/hooks/use-balance-reminders';
import { useCustomerSearch } from '../../../features/customers/hooks/use-customers';
import { useAllVans } from '../../../features/vans/hooks/use-vans';
import { useCan } from '../../../features/authz/hooks/use-can';
import { cn } from '@water-supply-crm/ui';

const WEEKDAYS = [
  { label: 'Monday', value: '1' },
  { label: 'Tuesday', value: '2' },
  { label: 'Wednesday', value: '3' },
  { label: 'Thursday', value: '4' },
  { label: 'Friday', value: '5' },
  { label: 'Saturday', value: '6' },
];

const REASON_LABELS: Record<string, string> = {
  'would-send': 'WILL SEND',
  'skipped-cooldown': 'COOLDOWN',
  'skipped-no-phone': 'NO PHONE',
  'skipped-low-balance': 'LOW BALANCE',
  'skipped-inactive': 'INACTIVE',
  'skipped-new-customer': 'NEW CUSTOMER',
  'skipped-excluded': 'EXCLUDED',
  'skipped-disconnected': 'DISCONNECTED',
  'skipped-invalid-phone': 'INVALID PHONE',
  'skipped-pdf-failed': 'PDF FAILED',
  'skipped-no-statement': 'NO STATEMENT',
  'skipped-too-soon': 'TOO SOON',
  'skipped-paid': 'PAID',
  'skipped-payment-pending': 'PAYMENT PENDING',
  'skipped-already-warned': 'ALREADY WARNED',
};

const REASON_STYLES: Record<string, string> = {
  'would-send': 'bg-emerald-500/10 text-emerald-400',
  'skipped-cooldown': 'bg-amber-500/10 text-amber-400',
  'skipped-no-phone': 'bg-destructive/10 text-destructive',
  'skipped-low-balance': 'bg-white/10 text-muted-foreground',
  'skipped-inactive': 'bg-white/10 text-muted-foreground',
  'skipped-new-customer': 'bg-blue-500/10 text-blue-400',
  'skipped-excluded': 'bg-violet-500/10 text-violet-400',
  'skipped-disconnected': 'bg-destructive/10 text-destructive',
  'skipped-invalid-phone': 'bg-destructive/10 text-destructive',
  'skipped-pdf-failed': 'bg-destructive/10 text-destructive',
  'skipped-no-statement': 'bg-white/10 text-muted-foreground',
  'skipped-too-soon': 'bg-amber-500/10 text-amber-400',
  'skipped-paid': 'bg-emerald-500/10 text-emerald-400',
  'skipped-payment-pending': 'bg-blue-500/10 text-blue-400',
  'skipped-already-warned': 'bg-violet-500/10 text-violet-400',
};

const KIND_LABEL: Record<string, string> = {
  REMINDER: 'Reminder',
  STATEMENT_ONLY: 'Statement',
  WARNING: 'Warning',
};

const KIND_STYLE: Record<string, string> = {
  REMINDER: 'bg-primary/10 text-primary',
  STATEMENT_ONLY: 'bg-blue-500/10 text-blue-400',
  WARNING: 'bg-amber-500/10 text-amber-400',
};

const KIND_TO_SENDKIND: Record<string, 'reminder' | 'statement_only' | 'warning'> = {
  REMINDER: 'reminder',
  STATEMENT_ONLY: 'statement_only',
  WARNING: 'warning',
};

/** Statuses that mean "attempted but not delivered" — eligible for re-send. */
const RESENDABLE_STATUSES = new Set(['failed', 'skipped-disconnected']);

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function formatMonthDisplay(yyyyMM: string) {
  const [year, mon] = yyyyMM.split('-').map(Number);
  return new Date(year, mon - 1, 1).toLocaleString('en-PK', { month: 'long', year: 'numeric' });
}

function csvEscape(value: unknown): string {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv(filename: string, headers: string[], rows: unknown[][]) {
  const lines = [headers, ...rows].map((row) => row.map(csvEscape).join(','));
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

type SendMode = 'eligible' | 'single';
type SendType = 'reminder' | 'statement_only' | 'warning';
type PaymentTypeFilter = 'MONTHLY' | 'CASH' | 'BOTH';

const SEND_TYPES: { value: SendType; label: string }[] = [
  { value: 'reminder', label: 'Reminder' },
  { value: 'statement_only', label: 'Statement Only' },
  { value: 'warning', label: 'Overdue Warning' },
];

export default function BalanceRemindersPage() {
  const { mutate: sendTargeted, isPending: isSending } = useSendTargeted();
  const { mutate: sendToOne } = useSendTargeted();
  const { mutate: preview, isPending: isPreviewing, data: previewData, reset: resetPreview } = usePreviewReminders();
  const { data: allVansData } = useAllVans();
  const { data: waStatus } = useWhatsAppStatus();
  const { data: warningConfig } = useReminderConfig();
  const { mutate: updateConfig, isPending: isSavingConfig } = useUpdateReminderConfig();
  const canConfigure = useCan('balance_reminders:configure');

  // Manual send state
  const [sendType, setSendType] = useState<SendType>('reminder');
  const [sendMode, setSendMode] = useState<SendMode>('eligible');
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [debouncedCustomerSearch, setDebouncedCustomerSearch] = useState('');
  const [customerDropdownOpen, setCustomerDropdownOpen] = useState(false);
  const [month, setMonth] = useState(currentMonth());
  const [includeStatement, setIncludeStatement] = useState(true);
  const [minBalance, setMinBalance] = useState('100');
  const [paymentTypeFilter, setPaymentTypeFilter] = useState<PaymentTypeFilter>('BOTH');
  const [vanFilter, setVanFilter] = useState('all');
  const [dayFilter, setDayFilter] = useState('all');
  const [showPreview, setShowPreview] = useState(false);
  const [previewTab, setPreviewTab] = useState<'send' | 'skipped'>('send');
  const [previewSearch, setPreviewSearch] = useState('');
  const [previewReasonFilter, setPreviewReasonFilter] = useState('all');
  const [excludedIds, setExcludedIds] = useState<Set<string>>(new Set());
  const [sentIds, setSentIds] = useState<Set<string>>(new Set());
  const [sendingCustomerId, setSendingCustomerId] = useState<string | null>(null);
  const [forceOverride, setForceOverride] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyDateFrom, setHistoryDateFrom] = useState('');
  const [historyDateTo, setHistoryDateTo] = useState('');
  const [historyResult, setHistoryResult] = useState<'all' | 'sent' | 'skipped'>('all');
  const [historyKind, setHistoryKind] = useState<'all' | 'REMINDER' | 'STATEMENT_ONLY' | 'WARNING'>('all');
  const { data: historyData, isLoading: isHistoryLoading } = useReminderHistory(historyPage, 8, {
    dateFrom: historyDateFrom || undefined,
    dateTo: historyDateTo || undefined,
    result: historyResult === 'all' ? undefined : historyResult,
    kind: historyKind === 'all' ? undefined : historyKind,
  });
  const [detailLogId, setDetailLogId] = useState<string | null>(null);
  const [detailSearch, setDetailSearch] = useState('');
  const { data: logDetail, isLoading: isDetailLoading } = useReminderHistoryDetail(detailLogId);
  const [resendingLogId, setResendingLogId] = useState<string | null>(null);

  // Overdue-warning config editor
  const [cfgDelay, setCfgDelay] = useState('');
  const [cfgMinBalance, setCfgMinBalance] = useState('');
  useEffect(() => {
    if (warningConfig) {
      setCfgDelay(String(warningConfig.warningDelayDays));
      setCfgMinBalance(String(warningConfig.warningMinBalance));
    }
  }, [warningConfig]);
  const [showWarnConfirm, setShowWarnConfirm] = useState(false);

  // Debounce combobox search so we don't hit the API on every keystroke
  useEffect(() => {
    const t = setTimeout(() => setDebouncedCustomerSearch(customerSearch), 300);
    return () => clearTimeout(t);
  }, [customerSearch]);

  const { data: customerSearchData, isFetching: isSearchingCustomers } = useCustomerSearch(
    debouncedCustomerSearch,
    sendMode === 'single',
  );
  const customerResults: any[] = (customerSearchData as any)?.data ?? [];

  const resolvedPaymentType = paymentTypeFilter === 'BOTH' ? undefined : paymentTypeFilter;
  const resolvedVanId = vanFilter === 'all' ? undefined : vanFilter;
  const resolvedDayOfWeek = dayFilter === 'all' ? undefined : Number(dayFilter);

  // Statement-only always attaches the PDF and ignores the balance threshold / cooldown-bypass.
  // Overdue-warning is text-only, uses the vendor's warningMinBalance, no threshold input.
  const isStatementOnly = sendType === 'statement_only';
  const isWarning = sendType === 'warning';
  const effectiveIncludeStatement = isStatementOnly ? true : isWarning ? false : includeStatement;
  const effectiveForce = isStatementOnly || isWarning ? false : forceOverride;

  const buildSendPayload = (dryRun = false) => {
    const base = { sendKind: sendType, mode: sendMode, month, includeStatement: effectiveIncludeStatement, dryRun, force: effectiveForce, paymentType: resolvedPaymentType };
    if (sendMode === 'single') return { ...base, customerIds: [selectedCustomerId] };
    return {
      ...base,
      minBalance: Number(minBalance),
      vanId: isWarning ? undefined : resolvedVanId,
      dayOfWeek: isWarning ? undefined : resolvedDayOfWeek,
      excludeCustomerIds: excludedIds.size > 0 ? Array.from(excludedIds) : undefined,
    };
  };

  const buildPreviewPayload = () => {
    const base = { sendKind: sendType, mode: sendMode, month, includeStatement: effectiveIncludeStatement, paymentType: resolvedPaymentType };
    if (sendMode === 'single') return { ...base, customerIds: [selectedCustomerId] };
    return { ...base, minBalance: Number(minBalance), vanId: isWarning ? undefined : resolvedVanId, dayOfWeek: isWarning ? undefined : resolvedDayOfWeek };
  };

  const lastWarningRun = ((historyData as any)?.data ?? []).find(
    (l: any) => l.kind === 'WARNING' && l.month === month && !l.dryRun,
  );

  const handlePreview = () => {
    setPreviewTab('send');
    setPreviewSearch('');
    setPreviewReasonFilter('all');
    setExcludedIds(new Set());
    setSentIds(new Set());
    setSendingCustomerId(null);
    setShowPreview(true);
    preview(buildPreviewPayload());
  };

  /** Send to exactly one customer from the preview list (same logic as single mode) */
  const handleSendToOne = (customerId: string) => {
    setSendingCustomerId(customerId);
    sendToOne(
      { sendKind: sendType, mode: 'single', customerIds: [customerId], month, includeStatement: effectiveIncludeStatement, force: effectiveForce } as any,
      {
        onSuccess: () => {
          setSentIds((prev) => new Set(prev).add(customerId));
          // Exclude from any subsequent bulk send so they don't get a duplicate
          setExcludedIds((prev) => new Set(prev).add(customerId));
        },
        onSettled: () => setSendingCustomerId(null),
      },
    );
  };

  const toggleExcluded = (customerId: string) => {
    setExcludedIds((prev) => {
      const next = new Set(prev);
      if (next.has(customerId)) next.delete(customerId);
      else next.add(customerId);
      return next;
    });
  };

  const doSend = () => {
    sendTargeted(buildSendPayload(false) as any, {
      onSuccess: () => {
        setShowPreview(false);
        setShowWarnConfirm(false);
        resetPreview();
      },
    });
  };

  // Overdue warnings are a stronger message than a reminder — make the operator confirm.
  const handleSend = () => {
    if (isWarning) { setShowWarnConfirm(true); return; }
    doSend();
  };

  const saveConfig = () => {
    updateConfig({
      warningDelayDays: cfgDelay ? Number(cfgDelay) : undefined,
      warningMinBalance: cfgMinBalance ? Number(cfgMinBalance) : undefined,
    });
  };

  // Block sends only once we KNOW WhatsApp is not connected (undefined = still loading → allow).
  const waBlocked = !!waStatus && waStatus.status !== 'connected';

  /** Re-send to just the customers a past run attempted but did not deliver. */
  const handleResendFailed = (log: any) => {
    const failedIds = ((log?.details ?? []) as any[])
      .filter((d) => RESENDABLE_STATUSES.has(d.status))
      .map((d) => d.customerId);
    if (failedIds.length === 0) return;
    setResendingLogId(log.id);
    sendTargeted(
      {
        sendKind: KIND_TO_SENDKIND[log.kind] ?? 'reminder',
        mode: 'selected',
        customerIds: failedIds,
        month: log.month,
        force: true,
      } as any,
      { onSettled: () => setResendingLogId(null) },
    );
  };

  const hasRecipients = sendMode === 'eligible' || (sendMode === 'single' && !!selectedCustomerId);
  const canSend = hasRecipients && !waBlocked;

  const previewResult = (previewData as any)?.data;
  const excludedInPreview = previewResult
    ? ((previewResult.wouldSend ?? []) as any[]).filter((e) => excludedIds.has(e.customerId)).length
    : 0;
  const effectiveSendCount = previewResult ? previewResult.totalWouldSend - excludedInPreview : 0;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Balance Reminders"
        description="Automatically notify customers with outstanding balances via WhatsApp"
      />

      {/* WhatsApp connection card */}
      {waStatus && (
        <Card className="bg-card/50 backdrop-blur-sm border-border/50 overflow-hidden">
          <CardContent className="p-4">
            {waStatus.status === 'connected' && (
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-full bg-emerald-500/15 flex items-center justify-center flex-shrink-0">
                  <Wifi className="h-4 w-4 text-emerald-500" />
                </div>
                <div>
                  <p className="text-sm font-bold text-emerald-500">WhatsApp Connected</p>
                  <p className="text-xs text-muted-foreground">Messages will be delivered to customers via Meta Cloud API.</p>
                </div>
              </div>
            )}

            {waStatus.status === 'disabled' && (
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-full bg-amber-500/15 flex items-center justify-center flex-shrink-0">
                  <WifiOff className="h-4 w-4 text-amber-500" />
                </div>
                <div>
                  <p className="text-sm font-bold text-amber-500">WhatsApp Disabled</p>
                  <p className="text-xs text-muted-foreground">Set WHATSAPP_ENABLED=true in server environment to enable.</p>
                </div>
              </div>
            )}

            {waStatus.status === 'disconnected' && (
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-full bg-destructive/15 flex items-center justify-center flex-shrink-0">
                  <WifiOff className="h-4 w-4 text-destructive" />
                </div>
                <div>
                  <p className="text-sm font-bold text-destructive">WhatsApp Not Connected</p>
                  <p className="text-xs text-muted-foreground">
                    Meta credentials missing — check META_WA_ACCESS_TOKEN / META_WA_PHONE_NUMBER_ID on the server.
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="max-w-2xl mx-auto w-full">
        <div className="space-y-6">
          <Card className="bg-card/50 backdrop-blur-sm border-border/50 overflow-hidden">
            <CardHeader className="pb-3 border-b border-border/50 bg-white/5">
              <CardTitle className="text-sm font-bold flex items-center gap-2 uppercase tracking-widest text-muted-foreground">
                <Send className="h-4 w-4 text-primary" />
                Manual Reminder
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-6 space-y-5">

              {/* Send type selector */}
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground ml-1">Send Type</Label>
                <div className="grid grid-cols-3 gap-2">
                  {SEND_TYPES.map((t) => (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => { setSendType(t.value); setSendMode('eligible'); setShowPreview(false); resetPreview(); }}
                      className={cn(
                        'flex items-center justify-center gap-1.5 px-2 py-2.5 rounded-xl text-[11px] font-bold border transition-colors',
                        sendType === t.value
                          ? 'bg-primary/15 border-primary/40 text-primary'
                          : 'bg-white/5 border-white/10 text-muted-foreground hover:bg-white/10',
                      )}
                    >
                      {t.value === 'reminder' ? <Send className="h-3.5 w-3.5" /> : t.value === 'statement_only' ? <FileText className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                      {t.label}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-muted-foreground ml-1">
                  {isStatementOnly
                    ? 'Pure monthly statement — no balance threshold, no payment request. PDF is always attached.'
                    : isWarning
                      ? `Text warning to customers sent a statement ≥ ${warningConfig?.warningDelayDays ?? 3} days ago who still owe ≥ ₨${(warningConfig?.warningMinBalance ?? 100).toLocaleString()}.`
                      : 'Balance reminder / statement with a payment request for customers over the threshold.'}
                </p>
                {isWarning && lastWarningRun && (
                  <p className="text-[10px] text-amber-400/80 ml-1">
                    Last warning run for {formatMonthDisplay(month)}: {lastWarningRun.sent} sent
                    {' · '}{new Date(lastWarningRun.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </p>
                )}
              </div>

              {/* Mode selector */}
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground ml-1">Recipients</Label>
                <div className="grid grid-cols-2 gap-2">
                  {(['eligible', 'single'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => { setSendMode(m); setShowPreview(false); resetPreview(); }}
                      className={cn(
                        'flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs font-bold border transition-colors',
                        sendMode === m
                          ? 'bg-primary/15 border-primary/40 text-primary'
                          : 'bg-white/5 border-white/10 text-muted-foreground hover:bg-white/10',
                      )}
                    >
                      {m === 'eligible' ? <Users className="h-3.5 w-3.5" /> : <User className="h-3.5 w-3.5" />}
                      {m === 'eligible' ? 'All Eligible' : 'Single Customer'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Payment type filter (eligible mode only; not for warnings) */}
              {sendMode === 'eligible' && !isWarning && (
                <div className="space-y-2 animate-in fade-in slide-in-from-top-2">
                  <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground ml-1">Customer Type</Label>
                  <div className="grid grid-cols-3 gap-2">
                    {(['BOTH', 'MONTHLY', 'CASH'] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => { setPaymentTypeFilter(t); setShowPreview(false); resetPreview(); }}
                        className={cn(
                          'px-3 py-2 rounded-xl text-xs font-bold border transition-colors',
                          paymentTypeFilter === t
                            ? 'bg-primary/15 border-primary/40 text-primary'
                            : 'bg-white/5 border-white/10 text-muted-foreground hover:bg-white/10',
                        )}
                      >
                        {t === 'BOTH' ? 'Both' : t === 'MONTHLY' ? 'Monthly' : 'Cash'}
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-muted-foreground ml-1">
                    {paymentTypeFilter === 'BOTH' ? 'All active customers with balance ≥ threshold.' : `Only ${paymentTypeFilter.toLowerCase()} customers.`}
                  </p>
                </div>
              )}

              {/* Van + delivery day filters (eligible mode only; not for warnings) */}
              {sendMode === 'eligible' && !isWarning && (
                <div className="grid grid-cols-2 gap-3 animate-in fade-in slide-in-from-top-2">
                  <div className="space-y-2">
                    <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground ml-1">Van</Label>
                    <Select
                      value={vanFilter}
                      onValueChange={(v) => { setVanFilter(v); setShowPreview(false); resetPreview(); }}
                    >
                      <SelectTrigger className="bg-accent/30 border-border/50 h-11 rounded-xl">
                        <SelectValue placeholder="All vans" />
                      </SelectTrigger>
                      <SelectContent className="rounded-xl border-border shadow-2xl max-h-64">
                        <SelectItem value="all">All Vans</SelectItem>
                        {(((allVansData as any)?.data ?? []) as any[]).map((v: any) => (
                          <SelectItem key={v.id} value={v.id}>{v.plateNumber}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground ml-1">Delivery Day</Label>
                    <Select
                      value={dayFilter}
                      onValueChange={(v) => { setDayFilter(v); setShowPreview(false); resetPreview(); }}
                    >
                      <SelectTrigger className="bg-accent/30 border-border/50 h-11 rounded-xl">
                        <SelectValue placeholder="All days" />
                      </SelectTrigger>
                      <SelectContent className="rounded-xl border-border shadow-2xl">
                        <SelectItem value="all">All Days</SelectItem>
                        {WEEKDAYS.map((d) => (
                          <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {(vanFilter !== 'all' || dayFilter !== 'all') && (
                    <p className="text-[10px] text-muted-foreground ml-1 col-span-2">
                      Only customers scheduled
                      {vanFilter !== 'all' ? ` on van ${(((allVansData as any)?.data ?? []) as any[]).find((v: any) => v.id === vanFilter)?.plateNumber ?? ''}` : ''}
                      {dayFilter !== 'all' ? ` for ${WEEKDAYS.find((d) => d.value === dayFilter)?.label}` : ''} deliveries.
                    </p>
                  )}
                </div>
              )}

              {/* Customer picker (single mode) — server-side searchable combobox */}
              {sendMode === 'single' && (
                <div className="space-y-2 animate-in fade-in slide-in-from-top-2">
                  <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground ml-1">Customer</Label>
                  <div className="relative">
                    <Input
                      placeholder="Search by name, code or phone…"
                      value={customerSearch}
                      onChange={(e) => {
                        setCustomerSearch(e.target.value);
                        setSelectedCustomerId('');
                        setCustomerDropdownOpen(true);
                        setShowPreview(false);
                        resetPreview();
                      }}
                      onFocus={() => setCustomerDropdownOpen(true)}
                      onBlur={() => setTimeout(() => setCustomerDropdownOpen(false), 150)}
                      className={cn(
                        'bg-accent/30 border-border/50 h-11 rounded-xl pr-9',
                        selectedCustomerId && 'border-primary/40',
                      )}
                    />
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      {isSearchingCustomers
                        ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        : selectedCustomerId
                          ? <CheckCircle2 className="h-4 w-4 text-primary" />
                          : <User className="h-4 w-4 text-muted-foreground/50" />}
                    </div>

                    {customerDropdownOpen && (
                      <div className="absolute z-50 mt-1 w-full rounded-xl border border-border bg-popover shadow-2xl max-h-64 overflow-y-auto">
                        {customerResults.length > 0 ? (
                          customerResults.map((c: any) => (
                            <button
                              key={c.id}
                              type="button"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                setSelectedCustomerId(c.id);
                                setCustomerSearch(`${c.name}${c.customerCode ? ` (${c.customerCode})` : ''}`);
                                setCustomerDropdownOpen(false);
                                setShowPreview(false);
                                resetPreview();
                              }}
                              className={cn(
                                'w-full text-left px-3 py-2 text-xs hover:bg-accent/50 transition-colors',
                                selectedCustomerId === c.id && 'bg-primary/10',
                              )}
                            >
                              <p className="font-semibold text-foreground dark:text-white truncate">
                                {c.name}
                                {c.customerCode && <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">({c.customerCode})</span>}
                              </p>
                              <p className="text-[10px] text-muted-foreground">
                                {c.financialBalance != null ? `₨${Number(c.financialBalance).toLocaleString()}` : ''}
                                {c.phoneNumber ? ` · ${c.phoneNumber}` : ''}
                              </p>
                            </button>
                          ))
                        ) : (
                          <p className="px-3 py-4 text-xs text-muted-foreground text-center">
                            {isSearchingCustomers ? 'Searching…' : debouncedCustomerSearch ? 'No customers found.' : 'Type to search customers…'}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Bulk min-balance (eligible mode, not statement-only) */}
              {sendMode === 'eligible' && !isStatementOnly && !isWarning && (
                <div className="space-y-2 animate-in fade-in slide-in-from-top-2">
                  <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground ml-1">Min Balance Threshold (₨)</Label>
                  <div className="relative">
                    <Input
                      type="number"
                      value={minBalance}
                      onChange={(e) => { setMinBalance(e.target.value); setShowPreview(false); resetPreview(); }}
                      placeholder="100"
                      className="bg-accent/30 border-border/50 font-mono h-11 rounded-xl pl-9"
                    />
                    <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/60 text-sm font-bold">₨</div>
                  </div>
                </div>
              )}

              {/* Month picker */}
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground ml-1">Billing Month</Label>
                <div className="relative">
                  <input
                    type="month"
                    value={month}
                    onChange={(e) => { setMonth(e.target.value); setShowPreview(false); resetPreview(); }}
                    className="w-full h-11 rounded-xl border border-border/50 bg-accent/30 px-3 text-sm text-foreground dark:text-white font-mono focus:outline-none focus:ring-1 focus:ring-primary/50"
                  />
                </div>
                <p className="text-[10px] text-muted-foreground ml-1">
                  The reminder will reference {month ? formatMonthDisplay(month) : 'the selected month'}.
                </p>
              </div>

              {/* Force override cooldown toggle (not shown for statement-only / warning) */}
              {!isStatementOnly && !isWarning && (
                <div className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/5">
                  <div className="flex items-center gap-2">
                    <Zap className="h-4 w-4 text-amber-400" />
                    <div>
                      <p className="text-xs font-bold text-foreground dark:text-white">Bypass 23h Cooldown</p>
                      <p className="text-[10px] text-muted-foreground">Re-send even if customer received a reminder today</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setForceOverride((v) => !v); setShowPreview(false); resetPreview(); }}
                    className={cn(
                      'relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none',
                      forceOverride ? 'bg-amber-400' : 'bg-white/20',
                    )}
                  >
                    <span
                      className={cn(
                        'inline-block h-4 w-4 rounded-full bg-white shadow transition-transform',
                        forceOverride ? 'translate-x-6' : 'translate-x-1',
                      )}
                    />
                  </button>
                </div>
              )}

              {/* Include statement toggle — forced ON/locked for statement-only, hidden for text-only warnings */}
              {!isWarning && (
                <div className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/5">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-primary" />
                    <div>
                      <p className="text-xs font-bold text-foreground dark:text-white">Attach Statement PDF</p>
                      <p className="text-[10px] text-muted-foreground">
                        {isStatementOnly ? 'Always attached in statement-only mode' : 'Sends the monthly statement PDF file with the message'}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={isStatementOnly}
                    onClick={() => { setIncludeStatement((v) => !v); setShowPreview(false); resetPreview(); }}
                    className={cn(
                      'relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none',
                      effectiveIncludeStatement ? 'bg-primary' : 'bg-white/20',
                      isStatementOnly && 'opacity-60 cursor-not-allowed',
                    )}
                  >
                    <span
                      className={cn(
                        'inline-block h-4 w-4 rounded-full bg-white shadow transition-transform',
                        effectiveIncludeStatement ? 'translate-x-6' : 'translate-x-1',
                      )}
                    />
                  </button>
                </div>
              )}

              {isWarning && (
                <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-500/5 border border-amber-500/20 text-[11px] text-amber-300/90">
                  <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                  <span>
                    Only customers already sent a statement this cycle who still owe are targeted. The delay and
                    minimum are set in <span className="font-bold">Overdue Warning Settings</span> below. Each customer
                    is warned at most once per billing month.
                  </span>
                </div>
              )}

              {/* Validation warning for single mode */}
              {sendMode === 'single' && !selectedCustomerId && (
                <div className="flex items-center gap-2 text-xs text-amber-400/80 px-1">
                  <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                  Select a customer to send a targeted reminder.
                </div>
              )}

              {/* Action buttons */}
              <div className="flex gap-2 pt-1">
                <Button
                  variant="outline"
                  onClick={handlePreview}
                  disabled={!hasRecipients || isPreviewing || isSending}
                  className="flex-1 rounded-xl h-10 text-xs font-bold border-border/50 bg-white/5 hover:bg-white/10"
                >
                  {isPreviewing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ChevronRight className="h-3.5 w-3.5 mr-1" />}
                  Preview
                </Button>
                <Button
                  onClick={handleSend}
                  disabled={!canSend || isSending || isPreviewing}
                  className={cn(
                    'flex-2 flex-1 rounded-xl h-10 text-xs font-bold shadow-lg',
                    isWarning ? 'bg-amber-600 hover:bg-amber-500 text-white shadow-amber-600/20' : 'shadow-primary/20',
                  )}
                >
                  {isSending ? (
                    <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Sending…</>
                  ) : (
                    <>{isWarning ? <AlertTriangle className="mr-1.5 h-3.5 w-3.5" /> : <Send className="mr-1.5 h-3.5 w-3.5" />} {isWarning ? 'Send Warnings' : 'Send Now'}</>
                  )}
                </Button>
              </div>

              {waBlocked && (
                <p className="text-[10px] text-destructive/90 italic px-1">
                  WhatsApp is not connected — sending is disabled until the connection is restored.
                </p>
              )}

              <p className="text-[10px] text-muted-foreground italic px-1">
                {isWarning
                  ? 'Each recipient will receive a WhatsApp overdue-balance warning — no PDF, no payment link.'
                  : isStatementOnly
                    ? 'Each recipient will receive their monthly statement PDF with a neutral cover message — no payment request.'
                    : effectiveIncludeStatement
                      ? 'Each recipient will receive a WhatsApp message with their monthly statement PDF attached.'
                      : 'Recipients will receive a WhatsApp balance reminder message.'}
              </p>
            </CardContent>
          </Card>

          {/* Overdue Warning Settings */}
          {canConfigure && (
            <Card className="bg-card/50 backdrop-blur-sm border-border/50 overflow-hidden">
              <CardHeader className="pb-3 border-b border-border/50 bg-white/5">
                <CardTitle className="text-sm font-bold flex items-center gap-2 uppercase tracking-widest text-muted-foreground">
                  <Settings2 className="h-4 w-4 text-primary" />
                  Overdue Warning Settings
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-6 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground ml-1">Delay (days)</Label>
                    <Input
                      type="number" min={1} max={14}
                      value={cfgDelay}
                      onChange={(e) => setCfgDelay(e.target.value)}
                      className="bg-accent/30 border-border/50 font-mono h-10 rounded-xl"
                    />
                    <p className="text-[10px] text-muted-foreground ml-1">Days after a statement before a warning may go out (1–14).</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground ml-1">Min Balance (₨)</Label>
                    <Input
                      type="number" min={0}
                      value={cfgMinBalance}
                      onChange={(e) => setCfgMinBalance(e.target.value)}
                      className="bg-accent/30 border-border/50 font-mono h-10 rounded-xl"
                    />
                    <p className="text-[10px] text-muted-foreground ml-1">Warn only if the live balance is at least this much.</p>
                  </div>
                </div>
                <Button
                  onClick={saveConfig}
                  disabled={isSavingConfig}
                  className="w-full rounded-xl h-9 text-xs font-bold"
                >
                  {isSavingConfig ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Save Settings'}
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Overdue-warning confirm speed-bump */}
      <Dialog open={showWarnConfirm} onOpenChange={setShowWarnConfirm}>
        <DialogContent className="rounded-3xl max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base text-amber-400">
              <AlertTriangle className="h-4 w-4" />
              Send overdue warnings?
            </DialogTitle>
            <DialogDescription className="text-xs pt-2">
              This sends a service-interruption warning — a stronger message than a normal reminder — to every
              eligible customer for {formatMonthDisplay(month)}. They are each warned at most once this month.
              {previewResult && isWarning ? ` Preview matched ${previewResult.totalWouldSend} customer(s).` : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setShowWarnConfirm(false)} className="rounded-xl h-9 text-xs font-bold">
              Cancel
            </Button>
            <Button
              onClick={doSend}
              disabled={isSending || waBlocked}
              className="rounded-xl h-9 text-xs font-bold bg-amber-600 hover:bg-amber-500 text-white"
            >
              {isSending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Yes, send warnings'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Send History */}
      <Card className="bg-card/50 backdrop-blur-sm border-border/50 overflow-hidden">
        <CardHeader className="pb-3 border-b border-border/50 bg-white/5">
          <CardTitle className="text-sm font-bold flex items-center gap-2 uppercase tracking-widest text-muted-foreground">
            <History className="h-4 w-4 text-primary" />
            Send History
            <span className="ml-auto text-[10px] font-medium normal-case tracking-normal text-muted-foreground/60">Click a row for details</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          {/* History filters */}
          <div className="flex flex-wrap items-end gap-3 mb-4">
            <div className="space-y-1">
              <Label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground ml-1">From</Label>
              <input
                type="date"
                value={historyDateFrom}
                onChange={(e) => { setHistoryDateFrom(e.target.value); setHistoryPage(1); }}
                className="h-8 rounded-lg border border-border/50 bg-accent/30 px-2 text-xs text-foreground dark:text-white font-mono focus:outline-none focus:ring-1 focus:ring-primary/50"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground ml-1">To</Label>
              <input
                type="date"
                value={historyDateTo}
                onChange={(e) => { setHistoryDateTo(e.target.value); setHistoryPage(1); }}
                className="h-8 rounded-lg border border-border/50 bg-accent/30 px-2 text-xs text-foreground dark:text-white font-mono focus:outline-none focus:ring-1 focus:ring-primary/50"
              />
            </div>
            <div className="flex gap-1.5">
              {(['all', 'sent', 'skipped'] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => { setHistoryResult(r); setHistoryPage(1); }}
                  className={cn(
                    'px-3 h-8 rounded-lg text-xs font-bold border transition-colors',
                    historyResult === r
                      ? 'bg-primary/15 border-primary/40 text-primary'
                      : 'bg-white/5 border-white/10 text-muted-foreground hover:bg-white/10',
                  )}
                >
                  {r === 'all' ? 'All' : r === 'sent' ? 'Sent' : 'Skipped'}
                </button>
              ))}
            </div>
            <div className="flex gap-1.5">
              {(['all', 'REMINDER', 'STATEMENT_ONLY', 'WARNING'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => { setHistoryKind(k); setHistoryPage(1); }}
                  className={cn(
                    'px-3 h-8 rounded-lg text-xs font-bold border transition-colors',
                    historyKind === k
                      ? 'bg-primary/15 border-primary/40 text-primary'
                      : 'bg-white/5 border-white/10 text-muted-foreground hover:bg-white/10',
                  )}
                >
                  {k === 'all' ? 'All Kinds' : KIND_LABEL[k]}
                </button>
              ))}
            </div>
            {(historyDateFrom || historyDateTo || historyResult !== 'all' || historyKind !== 'all') && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setHistoryDateFrom(''); setHistoryDateTo(''); setHistoryResult('all'); setHistoryKind('all'); setHistoryPage(1); }}
                className="h-8 px-2 rounded-lg text-xs text-muted-foreground"
              >
                Clear
              </Button>
            )}
          </div>

          {isHistoryLoading ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-10 rounded-xl bg-accent/30 animate-pulse" />
              ))}
            </div>
          ) : !historyData || (historyData as any).total === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center space-y-2">
              <History className="h-8 w-8 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">
                {historyDateFrom || historyDateTo || historyResult !== 'all' || historyKind !== 'all'
                  ? 'No sends match these filters.'
                  : 'No reminders have been sent yet.'}
              </p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground border-b border-border/30">
                      <th className="text-left pb-2 pr-4">Date</th>
                      <th className="text-left pb-2 pr-4">Kind</th>
                      <th className="text-left pb-2 pr-4">Trigger</th>
                      <th className="text-left pb-2 pr-4">Mode</th>
                      <th className="text-left pb-2 pr-4">Month</th>
                      <th className="text-right pb-2 pr-4">Sent</th>
                      <th className="text-right pb-2">Skipped</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/20">
                    {((historyData as any).data ?? []).map((log: any) => (
                      <tr
                        key={log.id}
                        className="hover:bg-white/5 transition-colors cursor-pointer"
                        onClick={() => { setDetailSearch(''); setDetailLogId(log.id); }}
                      >
                        <td className="py-2.5 pr-4 text-muted-foreground whitespace-nowrap">
                          {new Date(log.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="py-2.5 pr-4">
                          <Badge className={cn(
                            'text-[9px] font-black px-1.5 border-none',
                            KIND_STYLE[log.kind] ?? 'bg-white/10 text-muted-foreground',
                          )}>
                            {(KIND_LABEL[log.kind] ?? log.kind ?? 'Reminder').toUpperCase()}
                          </Badge>
                        </td>
                        <td className="py-2.5 pr-4">
                          <Badge className={cn(
                            'text-[9px] font-black px-1.5 border-none',
                            log.trigger === 'cron' ? 'bg-blue-500/10 text-blue-400' : 'bg-violet-500/10 text-violet-400',
                          )}>
                            {log.trigger.toUpperCase()}
                          </Badge>
                        </td>
                        <td className="py-2.5 pr-4 text-muted-foreground capitalize">{log.mode}</td>
                        <td className="py-2.5 pr-4 font-mono text-foreground dark:text-white">{log.month}</td>
                        <td className="py-2.5 pr-4 text-right">
                          <span className="text-emerald-400 font-bold">{log.sent}</span>
                        </td>
                        <td className="py-2.5 text-right text-muted-foreground">{log.skipped}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {(historyData as any).totalPages > 1 && (
                <div className="flex items-center justify-between mt-4 pt-3 border-t border-border/30">
                  <span className="text-[10px] text-muted-foreground">
                    Page {(historyData as any).page} of {(historyData as any).totalPages}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 rounded-lg text-xs"
                      disabled={historyPage <= 1}
                      onClick={() => setHistoryPage((p) => p - 1)}
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 rounded-lg text-xs"
                      disabled={historyPage >= (historyData as any).totalPages}
                      onClick={() => setHistoryPage((p) => p + 1)}
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

      {/* Preview dialog */}
      <Dialog open={showPreview} onOpenChange={(open) => { if (!open) { setShowPreview(false); resetPreview(); } }}>
        <DialogContent className="rounded-3xl max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Info className="h-4 w-4 text-primary" />
              Preview — {formatMonthDisplay(month)}
            </DialogTitle>
          </DialogHeader>

          {isPreviewing || !previewResult ? (
            <div className="flex items-center justify-center py-12 gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading preview…
            </div>
          ) : (
            <div className="flex flex-col gap-4 overflow-hidden">
              {/* Summary + skip-reason breakdown */}
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge className="bg-emerald-500/10 text-emerald-400 text-[10px] font-black px-2 border-none">
                  {effectiveSendCount} WILL RECEIVE
                </Badge>
                {excludedInPreview > 0 && (
                  <Badge className="bg-violet-500/10 text-violet-400 text-[10px] font-black px-2 border-none">
                    {excludedInPreview} EXCLUDED BY YOU
                  </Badge>
                )}
                {Object.entries(
                  (previewResult.skipped ?? []).reduce((acc: Record<string, number>, s: any) => {
                    acc[s.reason] = (acc[s.reason] ?? 0) + 1;
                    return acc;
                  }, {})
                ).map(([reason, count]) => (
                  <Badge key={reason} className={cn('text-[10px] font-black px-2 border-none', REASON_STYLES[reason] ?? 'bg-white/10 text-muted-foreground')}>
                    {String(count)} {REASON_LABELS[reason] ?? reason.toUpperCase()}
                  </Badge>
                ))}
                {isStatementOnly && (
                  <Badge className="bg-primary/10 text-primary text-[10px] font-bold px-2 border-none">
                    Statement Only
                  </Badge>
                )}
                {effectiveIncludeStatement && !isStatementOnly && (
                  <Badge className="bg-primary/10 text-primary text-[10px] font-bold px-2 border-none">
                    With Statement PDF
                  </Badge>
                )}
              </div>

              {/* Tabs */}
              <div className="grid grid-cols-2 gap-2">
                {(['send', 'skipped'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => { setPreviewTab(t); setPreviewReasonFilter('all'); }}
                    className={cn(
                      'px-3 py-2 rounded-xl text-xs font-bold border transition-colors',
                      previewTab === t
                        ? 'bg-primary/15 border-primary/40 text-primary'
                        : 'bg-white/5 border-white/10 text-muted-foreground hover:bg-white/10',
                    )}
                  >
                    {t === 'send' ? `Will Receive (${previewResult.totalWouldSend})` : `Skipped (${previewResult.totalSkipped})`}
                  </button>
                ))}
              </div>

              {/* Reason filter chips — skipped tab only */}
              {previewTab === 'skipped' && (previewResult.skipped ?? []).length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => setPreviewReasonFilter('all')}
                    className={cn(
                      'px-2.5 h-7 rounded-lg text-[10px] font-bold border transition-colors',
                      previewReasonFilter === 'all'
                        ? 'bg-primary/15 border-primary/40 text-primary'
                        : 'bg-white/5 border-white/10 text-muted-foreground hover:bg-white/10',
                    )}
                  >
                    All ({previewResult.totalSkipped})
                  </button>
                  {Object.entries(
                    (previewResult.skipped ?? []).reduce((acc: Record<string, number>, s: any) => {
                      acc[s.reason] = (acc[s.reason] ?? 0) + 1;
                      return acc;
                    }, {})
                  ).map(([reason, count]) => (
                    <button
                      key={reason}
                      type="button"
                      onClick={() => setPreviewReasonFilter(reason)}
                      className={cn(
                        'px-2.5 h-7 rounded-lg text-[10px] font-bold border transition-colors',
                        previewReasonFilter === reason
                          ? 'bg-primary/15 border-primary/40 text-primary'
                          : 'bg-white/5 border-white/10 text-muted-foreground hover:bg-white/10',
                      )}
                    >
                      {REASON_LABELS[reason] ?? reason.toUpperCase()} ({String(count)})
                    </button>
                  ))}
                </div>
              )}

              <Input
                placeholder="Search by name, code or phone…"
                value={previewSearch}
                onChange={(e) => setPreviewSearch(e.target.value)}
                className="bg-accent/30 border-border/50 h-9 rounded-xl text-xs"
              />

              {/* Customer list */}
              <div className="overflow-y-auto rounded-xl border border-border/40 divide-y divide-border/20 min-h-0">
                {((previewTab === 'send' ? previewResult.wouldSend : previewResult.skipped) ?? [])
                  .filter((e: any) => {
                    if (previewTab === 'skipped' && previewReasonFilter !== 'all' && e.reason !== previewReasonFilter) return false;
                    if (!previewSearch) return true;
                    const q = previewSearch.toLowerCase();
                    return (
                      e.name?.toLowerCase().includes(q) ||
                      e.customerCode?.toLowerCase().includes(q) ||
                      e.phone?.toLowerCase().includes(q)
                    );
                  })
                  .map((e: any) => {
                    const isSent = sentIds.has(e.customerId);
                    const isRowSending = sendingCustomerId === e.customerId;
                    const isExcluded = !isSent && excludedIds.has(e.customerId);
                    return (
                      <div
                        key={e.customerId}
                        className={cn(
                          'flex items-center justify-between px-3 py-2 text-xs hover:bg-white/5',
                          isExcluded && 'opacity-50',
                          isSent && 'bg-emerald-500/5',
                        )}
                      >
                        <div className="min-w-0 flex-1">
                          <p className={cn('font-semibold text-foreground dark:text-white truncate', isExcluded && 'line-through')}>
                            {e.name}
                            {e.customerCode && <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">({e.customerCode})</span>}
                          </p>
                          <p className="text-[10px] text-muted-foreground">
                            ₨{Number(e.balance ?? 0).toLocaleString()}
                            {' · '}{e.phone || <span className="text-destructive">no phone</span>}
                            {' · '}{e.paymentType === 'MONTHLY' ? 'Monthly' : 'Cash'}
                          </p>
                        </div>
                        <Badge className={cn(
                          'text-[9px] font-black px-1.5 border-none flex-shrink-0 ml-3',
                          isSent
                            ? 'bg-emerald-500/10 text-emerald-400'
                            : isExcluded
                              ? REASON_STYLES['skipped-excluded']
                              : (REASON_STYLES[e.reason] ?? 'bg-white/10 text-muted-foreground'),
                        )}>
                          {isSent ? 'SENT' : isExcluded ? 'EXCLUDED' : (REASON_LABELS[e.reason] ?? String(e.reason).toUpperCase())}
                        </Badge>
                        {previewTab === 'send' && !isSent && (
                          <>
                            <Button
                              size="sm"
                              onClick={() => handleSendToOne(e.customerId)}
                              disabled={isRowSending || !!sendingCustomerId || isSending || isExcluded || waBlocked}
                              className="h-6 px-2 ml-2 rounded-lg text-[10px] font-bold flex-shrink-0 bg-emerald-600 hover:bg-emerald-500 text-white shadow-none"
                            >
                              {isRowSending
                                ? <Loader2 className="h-3 w-3 animate-spin" />
                                : <><Send className="h-2.5 w-2.5 mr-1" /> Send</>}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => toggleExcluded(e.customerId)}
                              disabled={isRowSending}
                              className={cn(
                                'h-6 px-2 ml-1.5 rounded-lg text-[10px] font-bold flex-shrink-0',
                                isExcluded
                                  ? 'text-emerald-400 hover:text-emerald-400 hover:bg-emerald-500/10'
                                  : 'text-destructive hover:text-destructive hover:bg-destructive/10',
                              )}
                            >
                              {isExcluded ? 'Undo' : 'Skip'}
                            </Button>
                          </>
                        )}
                      </div>
                    );
                  })}
                {((previewTab === 'send' ? previewResult.wouldSend : previewResult.skipped) ?? []).length === 0 && (
                  <p className="text-xs text-muted-foreground italic py-6 text-center">
                    {previewTab === 'send' ? 'No customers will receive this reminder.' : 'No customers were skipped.'}
                  </p>
                )}
              </div>

              {/* Footer actions */}
              <div className="flex gap-2 pt-1">
                <Button
                  variant="outline"
                  onClick={() => { setShowPreview(false); resetPreview(); }}
                  className="flex-1 rounded-xl h-10 text-xs font-bold border-border/50 bg-white/5 hover:bg-white/10"
                >
                  Close
                </Button>
                <Button
                  onClick={doSend}
                  disabled={isSending || effectiveSendCount === 0 || waBlocked}
                  className={cn(
                    'flex-1 rounded-xl h-10 text-xs font-bold shadow-lg',
                    isWarning ? 'bg-amber-600 hover:bg-amber-500 text-white shadow-amber-600/20' : 'shadow-primary/20',
                  )}
                >
                  {isSending ? (
                    <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Sending…</>
                  ) : (
                    <>{isWarning ? <AlertTriangle className="mr-1.5 h-3.5 w-3.5" /> : <Send className="mr-1.5 h-3.5 w-3.5" />} Send to {effectiveSendCount}</>
                  )}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Send detail dialog */}
      <Dialog open={!!detailLogId} onOpenChange={(open) => { if (!open) setDetailLogId(null); }}>
        <DialogContent className="rounded-3xl max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <History className="h-4 w-4 text-primary" />
              Reminder Send Detail
            </DialogTitle>
          </DialogHeader>

          {isDetailLoading || !logDetail ? (
            <div className="flex items-center justify-center py-12 gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : (
            <div className="flex flex-col gap-4 overflow-hidden">
              {/* Filter / context chips */}
              <div className="flex flex-wrap gap-1.5">
                <Badge className={cn(
                  'text-[9px] font-black px-1.5 border-none',
                  KIND_STYLE[(logDetail as any).kind] ?? 'bg-white/10 text-muted-foreground',
                )}>
                  {(KIND_LABEL[(logDetail as any).kind] ?? (logDetail as any).kind ?? 'Reminder').toUpperCase()}
                </Badge>
                <Badge className={cn(
                  'text-[9px] font-black px-1.5 border-none',
                  (logDetail as any).trigger === 'cron' ? 'bg-blue-500/10 text-blue-400' : 'bg-violet-500/10 text-violet-400',
                )}>
                  {String((logDetail as any).trigger).toUpperCase()}
                </Badge>
                <Badge className="bg-white/10 text-foreground dark:text-white text-[9px] font-bold px-1.5 border-none capitalize">
                  {(logDetail as any).mode}
                </Badge>
                <Badge className="bg-white/10 text-foreground dark:text-white text-[9px] font-bold px-1.5 border-none font-mono">
                  {(logDetail as any).month}
                </Badge>
                {(logDetail as any).minBalance != null && (
                  <Badge className="bg-white/10 text-foreground dark:text-white text-[9px] font-bold px-1.5 border-none">
                    Min ₨{Number((logDetail as any).minBalance).toLocaleString()}
                  </Badge>
                )}
                <Badge className="bg-white/10 text-foreground dark:text-white text-[9px] font-bold px-1.5 border-none">
                  {(logDetail as any).paymentType ?? 'Monthly + Cash'}
                </Badge>
                {(logDetail as any).vanId && (
                  <Badge className="bg-primary/10 text-primary text-[9px] font-bold px-1.5 border-none">
                    Van: {(((allVansData as any)?.data ?? []) as any[]).find((v: any) => v.id === (logDetail as any).vanId)?.plateNumber ?? (logDetail as any).vanId}
                  </Badge>
                )}
                {(logDetail as any).dayOfWeek != null && (
                  <Badge className="bg-primary/10 text-primary text-[9px] font-bold px-1.5 border-none">
                    {WEEKDAYS.find((d) => d.value === String((logDetail as any).dayOfWeek))?.label ?? `Day ${(logDetail as any).dayOfWeek}`}
                  </Badge>
                )}
                {(logDetail as any).force && (
                  <Badge className="bg-amber-500/10 text-amber-400 text-[9px] font-bold px-1.5 border-none">
                    Cooldown Bypassed
                  </Badge>
                )}
                {(logDetail as any).includeStatement && (
                  <Badge className="bg-emerald-500/10 text-emerald-400 text-[9px] font-bold px-1.5 border-none">
                    With Statement
                  </Badge>
                )}
              </div>

              {/* Summary */}
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <span className="text-muted-foreground">
                  {new Date((logDetail as any).createdAt).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </span>
                <span className="text-emerald-400 font-bold">{(logDetail as any).sent} sent</span>
                <span className="text-muted-foreground">{(logDetail as any).skipped} skipped</span>

                {(() => {
                  const resendable = (((logDetail as any).details ?? []) as any[]).filter((d) => RESENDABLE_STATUSES.has(d.status));
                  if (resendable.length === 0) return null;
                  const isResending = resendingLogId === (logDetail as any).id;
                  return (
                    <Button
                      size="sm"
                      onClick={() => handleResendFailed(logDetail)}
                      disabled={isResending || isSending || waBlocked}
                      className="h-7 px-2.5 rounded-lg text-[10px] font-bold bg-primary/90 hover:bg-primary text-primary-foreground"
                    >
                      {isResending
                        ? <Loader2 className="h-3 w-3 animate-spin" />
                        : <><Send className="h-3 w-3 mr-1" /> Re-send to Failed ({resendable.length})</>}
                    </Button>
                  );
                })()}

                {(logDetail as any).skipped > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const notSent = (((logDetail as any).details ?? []) as any[]).filter((d) => d.status !== 'sent');
                      downloadCsv(
                        `not-sent_${(logDetail as any).month}_${new Date((logDetail as any).createdAt).toISOString().slice(0, 10)}.csv`,
                        ['Name', 'Customer Code', 'Phone', 'Balance', 'Reason'],
                        notSent.map((d) => [
                          d.name ?? '',
                          d.customerCode ?? '',
                          d.phone ?? '',
                          d.balance ?? '',
                          d.status === 'failed' ? 'FAILED' : (REASON_LABELS[d.status] ?? String(d.status).toUpperCase()),
                        ]),
                      );
                    }}
                    className="ml-auto h-7 px-2.5 rounded-lg text-[10px] font-bold border-border/50 bg-white/5 hover:bg-white/10"
                  >
                    <Download className="h-3 w-3 mr-1" /> Export Not-Sent ({(logDetail as any).skipped})
                  </Button>
                )}
              </div>

              {/* Per-customer results */}
              {Array.isArray((logDetail as any).details) && (logDetail as any).details.length > 0 ? (
                <>
                  <Input
                    placeholder="Search customer…"
                    value={detailSearch}
                    onChange={(e) => setDetailSearch(e.target.value)}
                    className="bg-accent/30 border-border/50 h-9 rounded-xl text-xs"
                  />
                  <div className="overflow-y-auto rounded-xl border border-border/40 divide-y divide-border/20 min-h-0">
                    {((logDetail as any).details as any[])
                      .filter((d) => !detailSearch || d.name?.toLowerCase().includes(detailSearch.toLowerCase()))
                      .map((d) => (
                        <div key={d.customerId} className="flex items-center justify-between px-3 py-2 text-xs hover:bg-white/5">
                          <div className="min-w-0 flex-1">
                            <p className="font-semibold text-foreground dark:text-white truncate">
                              {d.name}
                              {d.customerCode && <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">({d.customerCode})</span>}
                            </p>
                            <p className="text-[10px] text-muted-foreground">
                              ₨{Number(d.balance ?? 0).toLocaleString()}
                              {d.phone && ` · ${d.phone}`}
                            </p>
                          </div>
                          <Badge className={cn(
                            'text-[9px] font-black px-1.5 border-none flex-shrink-0 ml-3',
                            d.status === 'sent' ? 'bg-emerald-500/10 text-emerald-400'
                              : d.status === 'failed' ? 'bg-destructive/10 text-destructive'
                              : (REASON_STYLES[d.status] ?? 'bg-white/10 text-muted-foreground'),
                          )}>
                            {d.status === 'sent' ? 'SENT' : d.status === 'failed' ? 'FAILED' : (REASON_LABELS[d.status] ?? String(d.status).toUpperCase())}
                          </Badge>
                        </div>
                      ))}
                  </div>
                </>
              ) : (
                <p className="text-xs text-muted-foreground italic py-4 text-center">
                  No per-customer detail recorded for this send (sent before detail logging was added).
                </p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
