'use client';

import { useState, useEffect } from 'react';
import { Bell, Send, Trash2, Clock, Users, CheckCircle2, Loader2, Calendar } from 'lucide-react';
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
  useSendRemindersNow,
} from '../../../features/balance-reminders/hooks/use-balance-reminders';
import { cn } from '@water-supply-crm/ui';

const PRESETS = [
  { label: 'Daily at 9 AM', value: '0 4 * * *' }, // UTC 4 AM = PKT 9 AM
  { label: 'Weekly Monday 9 AM', value: '0 4 * * 1' },
  { label: 'Monthly 1st at 9 AM', value: '0 4 1 * *' },
  { label: 'Custom', value: 'custom' },
];

export default function BalanceRemindersPage() {
  const { data: schedule, isLoading } = useReminderSchedule();
  const { mutate: setSchedule, isPending: isSaving } = useSetReminderSchedule();
  const { mutate: deleteSchedule, isPending: isDeleting } = useDeleteReminderSchedule();
  const { mutate: sendNow, isPending: isSending } = useSendRemindersNow();

  const [preset, setPreset] = useState('0 4 * * *');
  const [customCron, setCustomCron] = useState('');
  const [minBalance, setMinBalance] = useState('100');
  const [deleteOpen, setDeleteOpen] = useState(false);

  // Sync form with loaded data
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
      setMinBalance(String(schedule.minBalance));
    }
  }, [schedule]);

  const cronValue = preset === 'custom' ? customCron : preset;

  const handleSave = () => {
    setSchedule({
      cronExpression: cronValue,
      minBalance: Number(minBalance),
    });
  };

  const formatDateTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="space-y-8">
      <PageHeader
        title="Balance Reminders"
        description="Automatically notify customers with outstanding balances via WhatsApp"
      />

      <div className="grid gap-6 lg:grid-cols-2">
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
                    value={minBalance}
                    onChange={(e) => setMinBalance(e.target.value)}
                    placeholder="100"
                    className="bg-accent/30 border-border/50 font-mono h-11 rounded-xl pl-9"
                  />
                  <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/60 text-sm font-bold">₨</div>
                </div>
                <p className="text-[10px] text-muted-foreground ml-1">Only customers with balance ≥ this amount will be notified.</p>
              </div>

              <Button
                onClick={handleSave}
                disabled={isSaving || (!cronValue && preset !== 'custom')}
                className="w-full rounded-xl font-bold shadow-lg shadow-primary/20 h-12"
              >
                {isSaving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...</> : <><CheckCircle2 className="mr-2 h-4 w-4" /> Save Configuration</>}
              </Button>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          {/* Send Now */}
          <Card className="bg-card/50 backdrop-blur-sm border-border/50 overflow-hidden h-full">
            <CardHeader className="pb-3 border-b border-border/50 bg-white/5">
              <CardTitle className="text-sm font-bold flex items-center gap-2 uppercase tracking-widest text-muted-foreground">
                <Send className="h-4 w-4 text-primary" />
                Manual Trigger
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-6 space-y-6">
              <div className="p-4 rounded-2xl bg-primary/5 border border-primary/10 space-y-2">
                <p className="text-sm font-bold text-white flex items-center gap-2">
                  <Users className="h-4 w-4 text-primary" />
                  Bulk Send
                </p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Immediately trigger reminders for all eligible customers. This ignores the schedule and runs once.
                </p>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-muted-foreground px-1">
                  <span>Current Threshold</span>
                  <span className="text-white">₨ {Number(minBalance).toLocaleString()}</span>
                </div>
                
                <Button
                  variant="secondary"
                  onClick={() => sendNow({ minBalance: Number(minBalance) })}
                  disabled={isSending}
                  className="w-full rounded-xl font-bold h-12 bg-white/5 hover:bg-white/10 border border-white/5"
                >
                  {isSending ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sending...</>
                  ) : (
                    <><Send className="mr-2 h-4 w-4" /> Send Bulk Reminders Now</>
                  )}
                </Button>
              </div>

              <div className="pt-4 border-t border-border/50">
                <p className="text-[10px] text-muted-foreground italic leading-relaxed">
                  * Targeted single-customer reminders coming soon.
                </p>
              </div>
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
