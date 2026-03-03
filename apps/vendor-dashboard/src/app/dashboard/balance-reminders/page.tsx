'use client';

import { useState, useEffect } from 'react';
import {
  Bell, Send, Trash2, Clock, Users, CheckCircle2, Loader2, Calendar,
  User, FileText, ChevronDown, ChevronRight, AlertCircle, Info,
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
} from '../../../features/balance-reminders/hooks/use-balance-reminders';
import { useAllCustomers } from '../../../features/customers/hooks/use-customers';
import { cn } from '@water-supply-crm/ui';

const PRESETS = [
  { label: 'Daily at 9 AM', value: '0 4 * * *' },
  { label: 'Weekly Monday 9 AM', value: '0 4 * * 1' },
  { label: 'Monthly 1st at 9 AM', value: '0 4 1 * *' },
  { label: 'Custom', value: 'custom' },
];

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function formatMonthDisplay(yyyyMM: string) {
  const [year, mon] = yyyyMM.split('-').map(Number);
  return new Date(year, mon - 1, 1).toLocaleString('en-PK', { month: 'long', year: 'numeric' });
}

type SendMode = 'eligible' | 'single';

export default function BalanceRemindersPage() {
  const { data: schedule, isLoading } = useReminderSchedule();
  const { mutate: setSchedule, isPending: isSaving } = useSetReminderSchedule();
  const { mutate: deleteSchedule, isPending: isDeleting } = useDeleteReminderSchedule();
  const { mutate: sendTargeted, isPending: isSending } = useSendTargeted();
  const { mutate: preview, isPending: isPreviewing, data: previewData, reset: resetPreview } = usePreviewReminders();
  const { data: allCustomersData } = useAllCustomers();

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
  const [showPreview, setShowPreview] = useState(false);

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

  const buildPayload = (dryRun = false) => {
    const base = {
      mode: sendMode,
      month,
      includeStatement,
      dryRun,
    };
    if (sendMode === 'single') {
      return { ...base, customerIds: [selectedCustomerId] };
    }
    return { ...base, minBalance: Number(minBalance) };
  };

  const handlePreview = () => {
    setShowPreview(true);
    preview(buildPayload(true) as any);
  };

  const handleSend = () => {
    sendTargeted(buildPayload(false) as any, {
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
                        <code className="text-sm font-mono bg-accent/50 px-2 py-0.5 rounded-lg text-white">{schedule.cronExpression}</code>
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
                      <p className="text-sm font-black text-white">₨ {Number(schedule.minBalance ?? 0).toLocaleString()}</p>
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
                    <p className="text-sm font-bold text-white">No active schedule</p>
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
                disabled={isSaving || (!cronValue && preset !== 'custom')}
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
                    className="w-full h-11 rounded-xl border border-border/50 bg-accent/30 px-3 text-sm text-white font-mono focus:outline-none focus:ring-1 focus:ring-primary/50"
                  />
                </div>
                <p className="text-[10px] text-muted-foreground ml-1">
                  The reminder will reference {month ? formatMonthDisplay(month) : 'the selected month'}.
                </p>
              </div>

              {/* Include statement toggle */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/5">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-primary" />
                  <div>
                    <p className="text-xs font-bold text-white">Include Statement Link</p>
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
                    <span className="text-xs font-bold text-white uppercase tracking-wider">Preview</span>
                    {isPreviewing && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground ml-auto" />}
                  </div>
                  <div className="p-3 space-y-2">
                    {previewResult ? (
                      <>
                        {sendMode === 'single' && selectedCustomer && (
                          <div className="text-xs space-y-1">
                            <p className="text-white font-semibold">{selectedCustomer.name}</p>
                            <p className="text-muted-foreground">
                              Balance: ₨{Number(selectedCustomer.financialBalance ?? 0).toLocaleString()} &nbsp;·&nbsp;
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
