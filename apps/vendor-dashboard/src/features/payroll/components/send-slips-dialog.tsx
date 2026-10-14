'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
  Button, Skeleton,
} from '@water-supply-crm/ui';
import { cn } from '@water-supply-crm/ui';
import { AlertCircle, CheckCircle2, ChevronDown, Loader2, MessageCircle, PhoneOff, Repeat2, TriangleAlert } from 'lucide-react';
import type { SendSlipsResult, SlipDocumentKind, SlipPreviewItem } from '../api/payroll.api';
import { useSendSlips, useSlipPreview, useSlipDispatchDetail } from '../hooks/use-salary-slips';
import {
  DOCUMENT_LABEL, DOCUMENT_KINDS, formatRupees, pendingKinds, sameKinds, SLIP_WARMUP_BATCH, SLIP_WARMUP_THRESHOLD, toggleKind,
} from '../lib/salary-slips';

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
  // Which documents everyone gets, plus the employees whose own choice differs from it.
  const [documents, setDocuments] = useState<SlipDocumentKind[]>(['SLIP']);
  const [overrides, setOverrides] = useState<Record<string, SlipDocumentKind[]>>({});
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const choice = useMemo(
    () => ({ documents, perEntry: Object.entries(overrides).map(([entryId, docs]) => ({ entryId, documents: docs })) }),
    [documents, overrides],
  );
  const preview = useSlipPreview(periodId, entryIds ?? undefined, open, choice);
  const send = useSendSlips(periodId);
  const [resend, setResend] = useState<ResendChoice>('skip');
  const [result, setResult] = useState<SendSlipsResult | null>(null);

  useEffect(() => {
    if (open) {
      setResend('skip');
      setResult(null);
      setDocuments(['SLIP']);
      setOverrides({});
      setCustomizeOpen(false);
      send.reset();
    }
  }, [open]);

  const items = preview.data?.items ?? [];
  const counts = preview.data?.counts;
  const eligible = useMemo(() => items.filter((i) => i.verdict === 'ELIGIBLE'), [items]);
  const alreadySent = eligible.filter((i) => i.alreadySentKinds.length > 0);
  // Employees who still have at least one document to receive, and how many WhatsApp messages that is in total.
  const toSend = eligible.filter((i) => pendingKinds(i, resend === 'again').length > 0);
  const messageCount = toSend.reduce((n, i) => n + pendingKinds(i, resend === 'again').length, 0);
  const notFinal = items.filter((i) => i.verdict === 'NOT_FINAL');
  const noPhone = items.filter((i) => i.verdict === 'NO_PHONE');
  const amountChanged = alreadySent.filter((i) => i.alreadySent?.amountChanged);
  const needsWarmup = messageCount > SLIP_WARMUP_THRESHOLD;
  // The preview shown on screen is for an older document choice until the re-fetch lands — never send from that.
  const choiceStale = preview.isPlaceholderData;

  // The confirmed set is pinned: exactly the entries shown in the preview (plus the no-phone ones, so they are
  // recorded as skipped) — an entry that became eligible after the preview is NOT messaged without confirmation.
  const pinnedIds = [...toSend, ...noPhone].map((i) => i.entryId);

  const submit = (ids?: string[]) => {
    const sendIds = ids ?? pinnedIds;
    send.mutate(
      {
        entryIds: sendIds,
        documents,
        // The server rejects an override for an entry that is not part of this send.
        perEntry: choice.perEntry.filter((o) => sendIds.includes(o.entryId)),
        ...(alreadySent.length > 0 ? (resend === 'again' ? { confirmResend: true } : { skipAlreadySent: true }) : {}),
      },
      { onSuccess: (r) => setResult(r) },
    );
  };

  // First employees whose messages fit the warm-up batch (an employee's documents are never split).
  const sendFirstBatch = () => {
    const ids: string[] = [];
    let messages = 0;
    for (const i of toSend) {
      const n = pendingKinds(i, resend === 'again').length;
      if (ids.length > 0 && messages + n > SLIP_WARMUP_BATCH) break;
      ids.push(i.entryId);
      messages += n;
    }
    submit(ids);
  };

  const changeDocuments = (kind: SlipDocumentKind) => {
    const next = toggleKind(documents, kind);
    if (next) setDocuments(next);
  };

  /** One employee's own choice; dropped again when it equals the everyone-choice. */
  const changeOverride = (item: SlipPreviewItem, kind: SlipDocumentKind) => {
    const next = toggleKind(item.documents, kind);
    if (!next) return;
    setOverrides((prev) => {
      const { [item.entryId]: _drop, ...rest } = prev;
      return sameKinds(next, documents) ? rest : { ...rest, [item.entryId]: next };
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !send.isPending && onOpenChange(o)}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageCircle className="h-5 w-5 text-emerald-500" />
            Send salary documents — {periodLabel}
          </DialogTitle>
          <DialogDescription>
            Each employee gets their own PDF(s) on WhatsApp — every document is a separate message. Messages go out one
            at a time with a random pause, so a large batch takes a few minutes.
          </DialogDescription>
        </DialogHeader>

        {!result && (
          <div className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">What to send</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {DOCUMENT_KINDS.map((kind) => (
                <label
                  key={kind}
                  className={cn(
                    'flex items-start gap-2.5 rounded-xl border p-3 cursor-pointer transition-colors',
                    documents.includes(kind) ? 'border-primary/50 bg-primary/5' : 'border-border/50 hover:bg-muted/30',
                  )}
                >
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={documents.includes(kind)}
                    disabled={send.isPending}
                    onChange={() => changeDocuments(kind)}
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-bold">{DOCUMENT_LABEL[kind].name}</span>
                    <span className="block text-xs text-muted-foreground">{DOCUMENT_LABEL[kind].hint}</span>
                  </span>
                </label>
              ))}
            </div>
            {eligible.length > 0 && (
              <div className="rounded-xl border border-border/50">
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs font-bold text-muted-foreground"
                  onClick={() => setCustomizeOpen((o) => !o)}
                >
                  <span>
                    Choose per employee
                    {Object.keys(overrides).length > 0 && ` · ${Object.keys(overrides).length} customised`}
                  </span>
                  <ChevronDown className={cn('h-4 w-4 transition-transform', customizeOpen && 'rotate-180')} />
                </button>
                {customizeOpen && (
                  <div className="max-h-48 divide-y divide-border/40 overflow-y-auto border-t border-border/40">
                    {eligible.map((i) => (
                      <div key={i.entryId} className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm">
                        <span className={cn('min-w-0 truncate', overrides[i.entryId] && 'font-semibold')}>{i.name}</span>
                        <span className="flex shrink-0 gap-1">
                          {DOCUMENT_KINDS.map((kind) => (
                            <Button
                              key={kind}
                              type="button"
                              size="sm"
                              variant={i.documents.includes(kind) ? 'default' : 'outline'}
                              className="h-6 rounded-md px-2 text-[11px] font-bold"
                              disabled={send.isPending}
                              onClick={() => changeOverride(i, kind)}
                            >
                              {kind === 'SLIP' ? 'Slip' : 'Receipt'}
                            </Button>
                          ))}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

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
              <Stat label={`Messages to ${toSend.length} employee${toSend.length === 1 ? '' : 's'}`} value={messageCount} tone="ok" />
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
                  {alreadySent.length} employee{alreadySent.length === 1 ? ' has' : 's have'} already been sent a chosen document
                  {amountChanged.length > 0 && ` — ${amountChanged.length} with a changed amount`}
                </p>
                <div className="space-y-1.5 text-sm">
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input type="radio" className="mt-1" checked={resend === 'skip'} onChange={() => setResend('skip')} />
                    <span>Skip what was already sent (send only the documents not sent yet)</span>
                  </label>
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input type="radio" className="mt-1" checked={resend === 'again'} onChange={() => setResend('again')} />
                    <span>Send them again too ({alreadySent.slice(0, 3).map((i) => `${i.name}: ${i.alreadySentKinds.map((k) => DOCUMENT_LABEL[k].name.replace('Salary ', '')).join(' + ')}`).join(', ')}
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
                disabled={send.isPending || preview.isLoading || choiceStale || !counts || (toSend.length === 0 && noPhone.length === 0)}
              >
                {send.isPending || choiceStale ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}
                {toSend.length > 0 ? `Send ${messageCount} message${messageCount === 1 ? '' : 's'}` : 'Record skipped'}
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
          ? `${result.queued} message${result.queued === 1 ? '' : 's'} queued — they are being sent one by one.`
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
          <DialogTitle>Salary document results</DialogTitle>
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
                    <p className="font-semibold">
                      {d.name}
                      <span className="ml-2 text-[11px] font-bold text-muted-foreground">{d.documentKind === 'RECEIPT' ? 'Receipt' : 'Slip'}</span>
                    </p>
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
