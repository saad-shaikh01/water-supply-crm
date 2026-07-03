'use client';

import { useState, useEffect } from 'react';
import {
  Bell, Send, Trash2, Clock, Users, CheckCircle2, Loader2, Calendar,
  User, FileText, ChevronDown, ChevronRight, AlertCircle, Info, Wifi, WifiOff, Zap, History,
  ChevronLeft,
} from 'lucide-react';
import {
  Card, CardContent, CardHeader, CardTitle, Button, Input, Label,
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  Badge,
} from '@water-supply-crm/ui';
import { PageHeader } from '../../../components/shared/page-header';
import { ConfirmDialog } from '../../../components/shared/confirm-dialog';
import {
  useReminderSchedule,
  useSetReminderSchedule,
  useDeleteReminderSchedule,
  useSendTargeted,
  usePreviewReminders,
  useWhatsAppStatus,
  useWhatsAppQr,
  useWhatsAppLogout,
  useReminderHistory,
} from '../../../features/balance-reminders/hooks/use-balance-reminders';
import { useAllCustomers } from '../../../features/customers/hooks/use-customers';
import { useAllVans } from '../../../features/vans/hooks/use-vans';
import { cn } from '@water-supply-crm/ui';

const PRESETS = [
  { label: 'Daily at 9 AM', value: '0 4 * * *' },
  { label: 'Weekly Monday 9 AM', value: '0 4 * * 1' },
  { label: 'Monthly 1st at 9 AM', value: '0 4 1 * *' },
  { label: 'Custom', value: 'custom' },
];

const WEEKDAYS = [
  { label: 'Monday', value: '1' },
  { label: 'Tuesday', value: '2' },
  { label: 'Wednesday', value: '3' },
  { label: 'Thursday', value: '4' },
  { label: 'Friday', value: '5' },
  { label: 'Saturday', value: '6' },
];

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function formatMonthDisplay(yyyyMM: string) {
  const [year, mon] = yyyyMM.split('-').map(Number);
  return new Date(year, mon - 1, 1).toLocaleString('en-PK', { month: 'long', year: 'numeric' });
}

type SendMode = 'eligible' | 'single';
type PaymentTypeFilter = 'MONTHLY' | 'CASH' | 'BOTH';

export default function BalanceRemindersPage() {
  const { data: schedule, isLoading } = useReminderSchedule();
  const { mutate: setSchedule, isPending: isSaving } = useSetReminderSchedule();
  const { mutate: deleteSchedule, isPending: isDeleting } = useDeleteReminderSchedule();
  const { mutate: sendTargeted, isPending: isSending } = useSendTargeted();
  const { mutate: preview, isPending: isPreviewing, data: previewData, reset: resetPreview } = usePreviewReminders();
  const { data: allCustomersData } = useAllCustomers();
  const { data: allVansData } = useAllVans();
  const { data: waStatus } = useWhatsAppStatus();
  const isDisconnected = waStatus?.status === 'disconnected';
  const { data: qrData } = useWhatsAppQr(isDisconnected);
  const { mutate: logoutWhatsApp, isPending: isLoggingOut } = useWhatsAppLogout();

  // Schedule config state
  const [preset, setPreset] = useState('0 4 * * *');
  const [customCron, setCustomCron] = useState('');
  const [scheduleMinBalance, setScheduleMinBalance] = useState('100');
  const [deleteOpen, setDeleteOpen] = useState(false);

  // Manual send state
  const [sendMode, setSendMode] = useState<SendMode>('eligible');
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [month, setMonth] = useState(currentMonth());
  const [includeStatement, setIncludeStatement] = useState(false);
  const [minBalance, setMinBalance] = useState('100');
  const [paymentTypeFilter, setPaymentTypeFilter] = useState<PaymentTypeFilter>('BOTH');
  const [vanFilter, setVanFilter] = useState('all');
  const [dayFilter, setDayFilter] = useState('all');
  const [showPreview, setShowPreview] = useState(false);
  const [forceOverride, setForceOverride] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  const { data: historyData, isLoading: isHistoryLoading } = useReminderHistory(historyPage, 8);

  // Sync schedule form with loaded data
  useEffect(() => {
    if (schedule?.cronExpression) {
      const isPreset = PRESETS.some(p => p.value === schedule.cronExpression);
      if (isPreset) {
        setPreset(schedule.cronExpression);
      } else {
        setPreset('custom');
        setCustomCron(schedule.cronExpression);
      }
    }
    if (schedule?.minBalance !== undefined) {
      setScheduleMinBalance(String(schedule.minBalance));
    }
  }, [schedule]);

  const cronValue = preset === 'custom' ? customCron : preset;

  const handleSaveSchedule = () => {
    setSchedule({ cronExpression: cronValue, minBalance: Number(scheduleMinBalance) });
  };

  const formatDateTime = (dateStr: string) =>
    new Date(dateStr).toLocaleString(undefined, {
      weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });

  const allCustomers: any[] = (allCustomersData as any)?.data ?? [];
  const selectedCustomer = allCustomers.find((c: any) => c.id === selectedCustomerId);

  const resolvedPaymentType = paymentTypeFilter === 'BOTH' ? undefined : paymentTypeFilter;
  const resolvedVanId = vanFilter === 'all' ? undefined : vanFilter;
  const resolvedDayOfWeek = dayFilter === 'all' ? undefined : Number(dayFilter);

  const buildSendPayload = (dryRun = false) => {
    const base = { mode: sendMode, month, includeStatement, dryRun, force: forceOverride, paymentType: resolvedPaymentType };
    if (sendMode === 'single') return { ...base, customerIds: [selectedCustomerId] };
    return { ...base, minBalance: Number(minBalance), vanId: resolvedVanId, dayOfWeek: resolvedDayOfWeek };
  };

  const buildPreviewPayload = () => {
    const base = { mode: sendMode, month, includeStatement, paymentType: resolvedPaymentType };
    if (sendMode === 'single') return { ...base, customerIds: [selectedCustomerId] };
    return { ...base, minBalance: Number(minBalance), vanId: resolvedVanId, dayOfWeek: resolvedDayOfWeek };
  };

  const handlePreview = () => {
    setShowPreview(true);
    preview(buildPreviewPayload());
  };

  const handleSend = () => {
    sendTargeted(buildSendPayload(false) as any, {
      onSuccess: () => {
        setShowPreview(false);
        resetPreview();
      },
    });
  };

  const canSend = sendMode === 'eligible' || (sendMode === 'single' && !!selectedCustomerId);

  const previewResult = (previewData as any)?.data;

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
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-full bg-emerald-500/15 flex items-center justify-center flex-shrink-0">
                    <Wifi className="h-4 w-4 text-emerald-500" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-emerald-500">WhatsApp Connected</p>
                    <p className="text-xs text-muted-foreground">Messages will be delivered to customers.</p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => logoutWhatsApp()}
                  disabled={isLoggingOut}
                  className="rounded-xl border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive h-8 text-xs font-bold"
                >
                  {isLoggingOut
                    ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Disconnecting…</>
                    : <><WifiOff className="h-3.5 w-3.5 mr-1.5" /> Disconnect</>}
                </Button>
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
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                <div className="flex items-center gap-3 flex-1">
                  <div className="h-9 w-9 rounded-full bg-destructive/15 flex items-center justify-center flex-shrink-0">
                    <WifiOff className="h-4 w-4 text-destructive" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-destructive">WhatsApp Not Connected</p>
                    <p className="text-xs text-muted-foreground">
                      {qrData?.qr ? 'Scan the QR code with your WhatsApp to connect.' : 'QR code is loading…'}
                    </p>
                  </div>
                </div>
                {qrData?.qr && (
                  <div className="flex flex-col items-center gap-2">
                    <div className="p-2 bg-white rounded-xl shadow-lg">
                      <img src={qrData.qr} alt="WhatsApp QR Code" className="h-36 w-36" />
                    </div>
                    <p className="text-[10px] text-muted-foreground">Refreshes every 15s</p>
                  </div>
                )}
                {!qrData?.qr && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading QR…
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ── Left column: schedule ── */}
        <div className="space-y-6">
          {/* Current Status Card */}
          <Card className="bg-card/50 backdrop-blur-sm border-border/50 overflow-hidden">
            <CardHeader className="pb-3 border-b border-border/50 bg-white/5">
              <CardTitle className="text-sm font-bold flex items-center gap-2 uppercase tracking-widest text-muted-foreground">
                <Clock className="h-4 w-4 text-primary" />
                Live Schedule
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-6">
              {isLoading ? (
                <div className="space-y-4">
                  <div className="h-12 rounded-xl bg-accent/30 animate-pulse" />
                  <div className="h-12 rounded-xl bg-accent/30 animate-pulse" />
                </div>
              ) : schedule?.scheduled ? (
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <p className="text-[10px] font-bold text-muted-foreground uppercase">Pattern</p>
                      <div className="flex items-center gap-2">
                        <Badge className="bg-emerald-500/10 text-emerald-500 border-none text-[10px] font-black px-2">ACTIVE</Badge>
                        <code className="text-sm font-mono bg-accent/50 px-2 py-0.5 rounded-lg text-foreground dark:text-white">{schedule.cronExpression}</code>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive hover:bg-destructive/10 rounded-xl h-8"
                      onClick={() => setDeleteOpen(true)}
                    >
                      <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Disable
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-3 rounded-2xl bg-white/5 border border-white/5 space-y-1">
                      <p className="text-[10px] font-bold text-muted-foreground uppercase">Min Balance</p>
                      <p className="text-sm font-black text-foreground dark:text-white">₨ {Number(schedule.minBalance ?? 0).toLocaleString()}</p>
                    </div>
                    <div className="p-3 rounded-2xl bg-white/5 border border-white/5 space-y-1">
                      <p className="text-[10px] font-bold text-muted-foreground uppercase">Next Run</p>
                      <p className="text-sm font-bold text-primary flex items-center gap-1.5">
                        <Calendar className="h-3 w-3" />
                        {schedule.nextRunAt ? formatDateTime(schedule.nextRunAt) : 'Not set'}
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-8 text-center space-y-3">
                  <div className="h-12 w-12 rounded-full bg-accent/30 flex items-center justify-center">
                    <Bell className="h-6 w-6 text-muted-foreground/40" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-bold text-foreground dark:text-white">No active schedule</p>
                    <p className="text-xs text-muted-foreground">Automated reminders are currently disabled.</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Configure Schedule */}
          <Card className="bg-card/50 backdrop-blur-sm border-border/50 overflow-hidden">
            <CardHeader className="pb-3 border-b border-border/50 bg-white/5">
              <CardTitle className="text-sm font-bold flex items-center gap-2 uppercase tracking-widest text-muted-foreground">
                <Bell className="h-4 w-4 text-primary" />
                Update Config
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6 pt-6">
              <div className="space-y-3">
                <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground ml-1">Frequency</Label>
                <Select value={preset} onValueChange={setPreset}>
                  <SelectTrigger className="bg-accent/30 border-border/50 h-11 rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl border-border shadow-2xl">
                    {PRESETS.map((p) => (
                      <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {preset === 'custom' && (
                <div className="space-y-3 animate-in fade-in slide-in-from-top-2">
                  <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground ml-1">Custom Cron Expression</Label>
                  <Input
                    placeholder="e.g. 0 9 * * 1-5"
                    value={customCron}
                    onChange={(e) => setCustomCron(e.target.value)}
                    className="font-mono bg-accent/30 border-border/50 h-11 rounded-xl"
                  />
                  <p className="text-[10px] text-muted-foreground ml-1 italic">Standard cron: minute hour day month weekday (UTC)</p>
                </div>
              )}

              <div className="space-y-3">
                <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground ml-1">Minimum Balance Threshold (₨)</Label>
                <div className="relative">
                  <Input
                    type="number"
                    value={scheduleMinBalance}
                    onChange={(e) => setScheduleMinBalance(e.target.value)}
                    placeholder="100"
                    className="bg-accent/30 border-border/50 font-mono h-11 rounded-xl pl-9"
                  />
                  <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/60 text-sm font-bold">₨</div>
                </div>
                <p className="text-[10px] text-muted-foreground ml-1">Only customers with balance ≥ this amount will be notified.</p>
              </div>

              <Button
                onClick={handleSaveSchedule}
                disabled={isSaving || !cronValue}
                className="w-full rounded-xl font-bold shadow-lg shadow-primary/20 h-12"
              >
                {isSaving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...</> : <><CheckCircle2 className="mr-2 h-4 w-4" /> Save Configuration</>}
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* ── Right column: manual send ── */}
        <div className="space-y-6">
          <Card className="bg-card/50 backdrop-blur-sm border-border/50 overflow-hidden">
            <CardHeader className="pb-3 border-b border-border/50 bg-white/5">
              <CardTitle className="text-sm font-bold flex items-center gap-2 uppercase tracking-widest text-muted-foreground">
                <Send className="h-4 w-4 text-primary" />
                Manual Reminder
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-6 space-y-5">

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

              {/* Payment type filter (eligible mode only) */}
              {sendMode === 'eligible' && (
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

              {/* Van + delivery day filters (eligible mode only) */}
              {sendMode === 'eligible' && (
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

              {/* Customer picker (single mode) */}
              {sendMode === 'single' && (
                <div className="space-y-2 animate-in fade-in slide-in-from-top-2">
                  <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground ml-1">Customer</Label>
                  <Select
                    value={selectedCustomerId}
                    onValueChange={(v) => { setSelectedCustomerId(v); setShowPreview(false); resetPreview(); }}
                  >
                    <SelectTrigger className="bg-accent/30 border-border/50 h-11 rounded-xl">
                      <SelectValue placeholder="Select customer…" />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl border-border shadow-2xl max-h-64">
                      {allCustomers.map((c: any) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                          {c.customerCode ? ` (${c.customerCode})` : ''}
                          {c.financialBalance != null ? ` — ₨${Number(c.financialBalance).toLocaleString()}` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Bulk min-balance (eligible mode) */}
              {sendMode === 'eligible' && (
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

              {/* Force override cooldown toggle */}
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

              {/* Include statement toggle */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/5">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-primary" />
                  <div>
                    <p className="text-xs font-bold text-foreground dark:text-white">Include Statement Link</p>
                    <p className="text-[10px] text-muted-foreground">Attaches a secure 7-day PDF link to the message</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => { setIncludeStatement((v) => !v); setShowPreview(false); resetPreview(); }}
                  className={cn(
                    'relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none',
                    includeStatement ? 'bg-primary' : 'bg-white/20',
                  )}
                >
                  <span
                    className={cn(
                      'inline-block h-4 w-4 rounded-full bg-white shadow transition-transform',
                      includeStatement ? 'translate-x-6' : 'translate-x-1',
                    )}
                  />
                </button>
              </div>

              {/* Preview panel */}
              {showPreview && (
                <div className="rounded-xl border border-border/50 overflow-hidden animate-in fade-in slide-in-from-top-2">
                  <div className="px-3 py-2 bg-white/5 border-b border-border/50 flex items-center gap-2">
                    <Info className="h-3.5 w-3.5 text-primary" />
                    <span className="text-xs font-bold text-foreground dark:text-white uppercase tracking-wider">Preview</span>
                    {isPreviewing && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground ml-auto" />}
                  </div>
                  <div className="p-3 space-y-2">
                    {previewResult ? (
                      <>
                        {sendMode === 'single' && selectedCustomer && (
                          <div className="text-xs space-y-1">
                            <p className="text-foreground dark:text-white font-semibold">{selectedCustomer.name}</p>
                            <p className="text-muted-foreground">
                              Balance ({formatMonthDisplay(month)}): ₨{Number(
                                ([...(previewResult.wouldSend ?? []), ...(previewResult.skipped ?? [])].find((e: any) => e.customerId === selectedCustomerId)?.balance)
                                ?? selectedCustomer.financialBalance ?? 0
                              ).toLocaleString()} &nbsp;·&nbsp;
                              Phone: {selectedCustomer.phoneNumber || <span className="text-destructive">No phone</span>}
                            </p>
                            {includeStatement && (
                              <p className="text-primary/80 text-[10px]">Statement PDF will be generated and linked for {formatMonthDisplay(month)}.</p>
                            )}
                          </div>
                        )}
                        {sendMode === 'eligible' && (
                          <div className="space-y-2">
                            <div className="flex items-center gap-3 text-xs">
                              <span className="text-emerald-400 font-bold">{previewResult.totalWouldSend} will receive</span>
                              <span className="text-muted-foreground">{previewResult.totalSkipped} skipped</span>
                            </div>
                            {previewResult.totalSkipped > 0 && (
                              <div className="text-[10px] text-muted-foreground space-y-0.5">
                                {Object.entries(
                                  (previewResult.skipped ?? []).reduce((acc: Record<string, number>, s: any) => {
                                    acc[s.reason] = (acc[s.reason] ?? 0) + 1;
                                    return acc;
                                  }, {})
                                ).map(([reason, count]) => (
                                  <p key={reason}>{String(count)}× {reason.replace('skipped-', '').replace(/-/g, ' ')}</p>
                                ))}
                              </div>
                            )}
                            {includeStatement && (
                              <p className="text-primary/80 text-[10px]">Statement PDFs will be generated for each recipient for {formatMonthDisplay(month)}.</p>
                            )}
                          </div>
                        )}
                      </>
                    ) : isPreviewing ? (
                      <p className="text-xs text-muted-foreground">Loading preview…</p>
                    ) : (
                      <p className="text-xs text-muted-foreground">Preview unavailable.</p>
                    )}
                  </div>
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
                  disabled={!canSend || isPreviewing || isSending}
                  className="flex-1 rounded-xl h-10 text-xs font-bold border-border/50 bg-white/5 hover:bg-white/10"
                >
                  {isPreviewing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ChevronRight className="h-3.5 w-3.5 mr-1" />}
                  Preview
                </Button>
                <Button
                  onClick={handleSend}
                  disabled={!canSend || isSending || isPreviewing}
                  className="flex-2 flex-1 rounded-xl h-10 text-xs font-bold shadow-lg shadow-primary/20"
                >
                  {isSending ? (
                    <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Sending…</>
                  ) : (
                    <><Send className="mr-1.5 h-3.5 w-3.5" /> Send Now</>
                  )}
                </Button>
              </div>

              <p className="text-[10px] text-muted-foreground italic px-1">
                {includeStatement
                  ? 'Each recipient will receive a WhatsApp message with their statement link (valid 7 days).'
                  : 'Recipients will receive a WhatsApp balance reminder message.'}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Send History */}
      <Card className="bg-card/50 backdrop-blur-sm border-border/50 overflow-hidden">
        <CardHeader className="pb-3 border-b border-border/50 bg-white/5">
          <CardTitle className="text-sm font-bold flex items-center gap-2 uppercase tracking-widest text-muted-foreground">
            <History className="h-4 w-4 text-primary" />
            Send History
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          {isHistoryLoading ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-10 rounded-xl bg-accent/30 animate-pulse" />
              ))}
            </div>
          ) : !historyData || (historyData as any).total === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center space-y-2">
              <History className="h-8 w-8 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">No reminders have been sent yet.</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground border-b border-border/30">
                      <th className="text-left pb-2 pr-4">Date</th>
                      <th className="text-left pb-2 pr-4">Trigger</th>
                      <th className="text-left pb-2 pr-4">Mode</th>
                      <th className="text-left pb-2 pr-4">Month</th>
                      <th className="text-right pb-2 pr-4">Sent</th>
                      <th className="text-right pb-2">Skipped</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/20">
                    {((historyData as any).data ?? []).map((log: any) => (
                      <tr key={log.id} className="hover:bg-white/5 transition-colors">
                        <td className="py-2.5 pr-4 text-muted-foreground whitespace-nowrap">
                          {new Date(log.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
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

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Disable Automated Reminders?"
        description="This will stop all future automated balance reminders for this vendor. You can re-enable them anytime by setting a new schedule."
        onConfirm={() => deleteSchedule(undefined, { onSuccess: () => setDeleteOpen(false) })}
        isLoading={isDeleting}
        confirmLabel="Disable Reminders"
      />
    </div>
  );
}
