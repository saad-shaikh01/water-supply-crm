'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
  Button, Skeleton,
} from '@water-supply-crm/ui';
import { cn } from '@water-supply-crm/ui';
import { AlertCircle, CheckCircle2, Loader2, MessageCircle, PhoneOff, Repeat2, TriangleAlert } from 'lucide-react';
import type { SendSlipsResult, SlipPreviewItem } from '../api/payroll.api';
import { useSendSlips, useSlipPreview, useSlipDispatchDetail } from '../hooks/use-salary-slips';
import { formatRupees, SLIP_WARMUP_BATCH, SLIP_WARMUP_THRESHOLD } from '../lib/salary-slips';

export interface SendSlipsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  periodId: string;
  periodLabel: string;
  /** Entries to send; `null` = every entry of the period ("Send to all"). */
  entryIds: string[] | null;
}

type ResendChoice = 'skip' | 'again';

/**
 * Confirm + send salary slips on WhatsApp. Always shows the server's preview first (who is eligible, who is
 * skipped and why, who was already sent) — nothing is sent until the admin confirms here. The send itself is
 * queued server-side; this dialog only reports what was queued.
 */
export function SendSlipsDialog({ open, onOpenChange, periodId, periodLabel, entryIds }: SendSlipsDialogProps) {
  const preview = useSlipPreview(periodId, entryIds ?? undefined, open);
  const send = useSendSlips(periodId);
  const [resend, setResend] = useState<ResendChoice>('skip');
  const [result, setResult] = useState<SendSlipsResult | null>(null);

  useEffect(() => {
    if (open) {
      setResend('skip');
      setResult(null);
      send.reset();
    }
  }, [open]);

  const items = preview.data?.items ?? [];
  const counts = preview.data?.counts;
  const eligible = useMemo(() => items.filter((i) => i.verdict === 'ELIGIBLE'), [items]);
  const alreadySent = eligible.filter((i) => i.alreadySent);
  const toSend = resend === 'again' ? eligible : eligible.filter((i) => !i.alreadySent);
  const notFinal = items.filter((i) => i.verdict === 'NOT_FINAL');
  const noPhone = items.filter((i) => i.verdict === 'NO_PHONE');
  const amountChanged = alreadySent.filter((i) => i.alreadySent?.amountChanged);
  const needsWarmup = toSend.length > SLIP_WARMUP_THRESHOLD;

  // The confirmed set is pinned: exactly the entries shown in the preview (plus the no-phone ones, so they are
  // recorded as skipped) — an entry that became eligible after the preview is NOT messaged without confirmation.
  const pinnedIds = [...toSend, ...noPhone].map((i) => i.entryId);

  const submit = (ids?: string[]) => {
    send.mutate(
      {
        entryIds: ids ?? pinnedIds,
        ...(alreadySent.length > 0 ? (resend === 'again' ? { confirmResend: true } : { skipAlreadySent: true }) : {}),
      },
      { onSuccess: (r) => setResult(r) },
    );
  };

  const sendFirstBatch = () => submit(toSend.slice(0, SLIP_WARMUP_BATCH).map((i) => i.entryId));

  return (
    <Dialog open={open} onOpenChange={(o) => !send.isPending && onOpenChange(o)}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageCircle className="h-5 w-5 text-emerald-500" />
            Send salary slips — {periodLabel}
          </DialogTitle>
          <DialogDescription>
            Each employee gets their own slip (PDF) on WhatsApp. Messages go out one at a time with a random pause, so
            a large batch takes a few minutes.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <QueuedSummary result={result} />
        ) : preview.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 rounded-xl" />
            <Skeleton className="h-24 rounded-xl" />
          </div>
        ) : preview.isError || !counts ? (
          <p className="text-sm text-destructive flex items-center gap-2">
            <AlertCircle className="h-4 w-4" /> Could not load the preview. Please try again.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2 text-center">
              <Stat label="Will be sent" value={toSend.length} tone="ok" />
              <Stat label="Not approved yet" value={counts.notFinal} tone={counts.notFinal ? 'warn' : 'muted'} />
              <Stat label="No WhatsApp number" value={counts.noPhone} tone={counts.noPhone ? 'warn' : 'muted'} />
            </div>

            {notFinal.length > 0 && (
              <NameList
                icon={<AlertCircle className="h-3.5 w-3.5" />}
                title="Skipped — final payable not set (approve first)"
                items={notFinal}
              />
            )}
            {noPhone.length > 0 && (
              <NameList icon={<PhoneOff className="h-3.5 w-3.5" />} title="Skipped — no valid phone number" items={noPhone} />
            )}

            {alreadySent.length > 0 && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
                <p className="text-xs font-bold text-amber-600 flex items-center gap-1.5">
                  <Repeat2 className="h-3.5 w-3.5" />
                  {alreadySent.length} slip{alreadySent.length === 1 ? ' was' : 's were'} already sent
                  {amountChanged.length > 0 && ` — ${amountChanged.length} with a changed amount`}
                </p>
                <div className="space-y-1.5 text-sm">
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input type="radio" className="mt-1" checked={resend === 'skip'} onChange={() => setResend('skip')} />
                    <span>Skip them (send only to those not sent yet)</span>
                  </label>
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input type="radio" className="mt-1" checked={resend === 'again'} onChange={() => setResend('again')} />
                    <span>Send them again too ({alreadySent.map((i) => i.name).slice(0, 3).join(', ')}
                      {alreadySent.length > 3 ? ` +${alreadySent.length - 3} more` : ''})</span>
                  </label>
                </div>
              </div>
            )}

            {needsWarmup && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-700 space-y-2">
                <p className="font-bold flex items-center gap-1.5">
                  <TriangleAlert className="h-3.5 w-3.5" /> Large batch — start small
                </p>
                <p>
                  Sending many WhatsApp messages at once from a number that is not warmed up can get it restricted.
                  Send the first {SLIP_WARMUP_BATCH} now, check they arrive, then send the rest.
                </p>
                <Button size="sm" variant="outline" className="rounded-lg h-7 text-xs font-bold" onClick={sendFirstBatch} disabled={send.isPending}>
                  Send first {SLIP_WARMUP_BATCH} only
                </Button>
              </div>
            )}

            {toSend.some((i) => i.finalPayable < 0) && (
              <p className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-700 flex items-start gap-1.5">
                <TriangleAlert className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                {toSend.filter((i) => i.finalPayable < 0).length} employee(s) have a NEGATIVE payable (they owe money) — their
                slip will show the negative amount: {toSend.filter((i) => i.finalPayable < 0).map((i) => i.name).slice(0, 3).join(', ')}.
              </p>
            )}

            {toSend.length === 0 && (
              <p className="text-sm text-muted-foreground">Nothing to send for the current selection.</p>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          {result ? (
            <Button className="rounded-xl font-bold" onClick={() => onOpenChange(false)}>Done</Button>
          ) : (
            <>
              <Button variant="outline" className="rounded-xl font-bold" onClick={() => onOpenChange(false)} disabled={send.isPending}>
                Cancel
              </Button>
              <Button
                className="rounded-xl font-bold gap-2"
                onClick={() => submit()}
                disabled={send.isPending || preview.isLoading || !counts || (toSend.length === 0 && noPhone.length === 0)}
              >
                {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}
                {toSend.length > 0 ? `Send ${toSend.length} slip${toSend.length === 1 ? '' : 's'}` : 'Record skipped'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: 'ok' | 'warn' | 'muted' }) {
  return (
    <div className="rounded-xl border border-border/50 bg-card/50 p-2.5">
      <p className={cn('text-xl font-black', tone === 'ok' && 'text-emerald-500', tone === 'warn' && 'text-amber-600', tone === 'muted' && 'text-muted-foreground')}>
        {value}
      </p>
      <p className="text-[11px] font-semibold text-muted-foreground">{label}</p>
    </div>
  );
}

function NameList({ icon, title, items }: { icon: React.ReactNode; title: string; items: SlipPreviewItem[] }) {
  return (
    <div className="rounded-xl border border-border/50 bg-muted/30 p-3 space-y-1.5">
      <p className="text-xs font-bold text-muted-foreground flex items-center gap-1.5">{icon}{title}</p>
      <p className="text-sm">
        {items.slice(0, 8).map((i) => i.name).join(', ')}
        {items.length > 8 && ` +${items.length - 8} more`}
      </p>
    </div>
  );
}

function QueuedSummary({ result }: { result: SendSlipsResult }) {
  return (
    <div className="space-y-3 text-sm">
      <p className="flex items-center gap-2 font-bold text-emerald-600">
        <CheckCircle2 className="h-4 w-4" />
        {result.queued > 0
          ? `${result.queued} slip${result.queued === 1 ? '' : 's'} queued — they are being sent one by one.`
          : 'Nothing was queued.'}
      </p>
      {result.queued > 0 && (
        <p className="text-xs text-muted-foreground">
          You can close this window. Progress shows above the table, and each row's chip updates as slips go out.
        </p>
      )}
      {result.skippedNoPhone.length > 0 && (
        <p><span className="font-semibold">No phone ({result.skippedNoPhone.length}):</span> {result.skippedNoPhone.map((i) => i.name).join(', ')}</p>
      )}
      {result.skippedNotFinal.length > 0 && (
        <p><span className="font-semibold">Not approved ({result.skippedNotFinal.length}):</span> {result.skippedNotFinal.map((i) => i.name).join(', ')}</p>
      )}
      {result.skippedAlreadySent.length > 0 && (
        <p><span className="font-semibold">Already sent, skipped ({result.skippedAlreadySent.length}):</span> {result.skippedAlreadySent.map((i) => i.name).join(', ')}</p>
      )}
    </div>
  );
}

// ── Results of one send (the banner's "Details") ────────────────────────────────

const DELIVERY_LABEL: Record<string, { label: string; className: string }> = {
  SENT: { label: 'Sent', className: 'text-emerald-600' },
  QUEUED: { label: 'Waiting', className: 'text-muted-foreground' },
  SENDING: { label: 'Sending', className: 'text-muted-foreground' },
  FAILED: { label: 'Failed', className: 'text-destructive' },
  SKIPPED_NO_PHONE: { label: 'No phone', className: 'text-amber-600' },
  SKIPPED_DISCONNECTED: { label: 'WhatsApp offline', className: 'text-amber-600' },
};

export function SlipDispatchResultDialog({ dispatchId, onOpenChange }: { dispatchId: string | null; onOpenChange: (open: boolean) => void }) {
  const { data, isLoading, isError } = useSlipDispatchDetail(dispatchId);
  return (
    <Dialog open={!!dispatchId} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Salary slip results</DialogTitle>
          {data && (
            <DialogDescription>
              {data.sent} sent · {data.failed} failed · {data.skipped} skipped of {data.total}
            </DialogDescription>
          )}
        </DialogHeader>
        {isLoading ? (
          <Skeleton className="h-32 rounded-xl" />
        ) : isError || !data ? (
          <p className="text-sm text-destructive">Could not load the results.</p>
        ) : (
          <div className="divide-y divide-border/40">
            {data.deliveries.map((d) => {
              const meta = DELIVERY_LABEL[d.status] ?? { label: d.status, className: '' };
              return (
                <div key={d.id} className="py-2 flex items-start justify-between gap-3 text-sm">
                  <div>
                    <p className="font-semibold">{d.name}</p>
                    {d.error && d.status !== 'SENT' && <p className="text-xs text-muted-foreground">{d.error}</p>}
                  </div>
                  <div className="text-right shrink-0">
                    <p className={cn('text-xs font-bold', meta.className)}>{meta.label}</p>
                    <p className="text-[11px] text-muted-foreground font-mono">₨ {formatRupees(d.finalPayable)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
