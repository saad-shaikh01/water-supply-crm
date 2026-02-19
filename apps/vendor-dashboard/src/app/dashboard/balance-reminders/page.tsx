'use client';

import { useState } from 'react';
import { Bell, Send, Trash2, Clock, Users, CheckCircle2, Loader2 } from 'lucide-react';
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
  { label: 'Daily at 9 AM', value: '0 9 * * *' },
  { label: 'Weekly Monday 9 AM', value: '0 9 * * 1' },
  { label: 'Monthly 1st at 9 AM', value: '0 9 1 * *' },
  { label: 'Custom', value: 'custom' },
];

export default function BalanceRemindersPage() {
  const { data: schedule, isLoading } = useReminderSchedule();
  const { mutate: setSchedule, isPending: isSaving } = useSetReminderSchedule();
  const { mutate: deleteSchedule, isPending: isDeleting } = useDeleteReminderSchedule();
  const { mutate: sendNow, isPending: isSending } = useSendRemindersNow();

  const existing = schedule as any;
  const [preset, setPreset] = useState('0 9 * * *');
  const [customCron, setCustomCron] = useState('');
  const [minBalance, setMinBalance] = useState('100');
  const [deleteOpen, setDeleteOpen] = useState(false);

  const cronValue = preset === 'custom' ? customCron : preset;

  const handleSave = () => {
    setSchedule({
      cron: cronValue,
      minBalance: Number(minBalance),
    });
  };

  return (
    <>
      <PageHeader
        title="Balance Reminders"
        description="Automatically notify customers with outstanding balances"
      />

      <div className="space-y-6 max-w-2xl">
        {/* Current Status Card */}
        <Card className="bg-card/50 backdrop-blur-sm border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-bold flex items-center gap-2">
              <Clock className="h-4 w-4 text-primary" />
              Current Schedule
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="h-10 rounded-xl bg-accent/30 animate-pulse" />
            ) : existing?.cron ? (
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Badge className="bg-emerald-500/10 text-emerald-500 border-none text-xs font-bold">Active</Badge>
                    <code className="text-sm font-mono bg-accent/50 px-2 py-0.5 rounded-lg">{existing.cron}</code>
                  </div>
                  {existing.minBalance && (
                    <p className="text-xs text-muted-foreground">
                      Customers with balance ≥ ₨ {Number(existing.minBalance).toLocaleString()}
                    </p>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive hover:bg-destructive/10 rounded-xl"
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2 className="h-4 w-4 mr-1" /> Remove
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Badge variant="outline" className="text-muted-foreground text-xs">Inactive</Badge>
                <span className="text-sm">No schedule configured</span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Configure Schedule */}
        <Card className="bg-card/50 backdrop-blur-sm border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-bold flex items-center gap-2">
              <Bell className="h-4 w-4 text-primary" />
              Configure Schedule
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label className="text-sm font-semibold">Frequency</Label>
              <Select value={preset} onValueChange={setPreset}>
                <SelectTrigger className="bg-accent/30 border-border/50">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRESETS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {preset === 'custom' && (
              <div className="space-y-2">
                <Label className="text-sm font-semibold">Custom Cron Expression</Label>
                <Input
                  placeholder="e.g. 0 9 * * 1-5"
                  value={customCron}
                  onChange={(e) => setCustomCron(e.target.value)}
                  className="font-mono bg-accent/30 border-border/50"
                />
                <p className="text-[11px] text-muted-foreground">Standard cron syntax: minute hour day month weekday</p>
              </div>
            )}

            <div className="space-y-2">
              <Label className="text-sm font-semibold">Minimum Balance (₨)</Label>
              <Input
                type="number"
                value={minBalance}
                onChange={(e) => setMinBalance(e.target.value)}
                placeholder="100"
                className="bg-accent/30 border-border/50 font-mono"
              />
              <p className="text-[11px] text-muted-foreground">Only send to customers with balance above this amount</p>
            </div>

            <Button
              onClick={handleSave}
              disabled={isSaving || (!cronValue && preset !== 'custom')}
              className="w-full rounded-xl font-bold shadow-lg shadow-primary/20 h-11"
            >
              {isSaving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...</> : <><CheckCircle2 className="mr-2 h-4 w-4" /> Save Schedule</>}
            </Button>
          </CardContent>
        </Card>

        {/* Send Now */}
        <Card className="bg-card/50 backdrop-blur-sm border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-bold flex items-center gap-2">
              <Send className="h-4 w-4 text-primary" />
              Send Immediately
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Send balance reminder notifications to all customers with outstanding balances right now, without waiting for the schedule.
            </p>
            <Button
              variant="secondary"
              onClick={() => sendNow({ minBalance: Number(minBalance) })}
              disabled={isSending}
              className="w-full rounded-xl font-bold h-11"
            >
              {isSending ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sending...</>
              ) : (
                <><Users className="mr-2 h-4 w-4" /> Send Now</>
              )}
            </Button>
          </CardContent>
        </Card>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Remove Schedule"
        description="This will stop automated balance reminders. You can set a new schedule anytime."
        onConfirm={() => deleteSchedule(undefined, { onSuccess: () => setDeleteOpen(false) })}
        isLoading={isDeleting}
        confirmLabel="Remove"
      />
    </>
  );
}
