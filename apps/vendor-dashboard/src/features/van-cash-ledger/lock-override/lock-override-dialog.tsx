'use client';

import { useId, useRef, useState } from 'react';
import { Lock } from 'lucide-react';
import {
  Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Label, Textarea, cn,
} from '@water-supply-crm/ui';
import { periodDisplayLabel } from '../components/timeline-format';
import {
  OVERRIDE_REASON_MAX, OVERRIDE_REASON_MIN, sanitizeOverrideReason, useLockOverrideStore, type OverridePrompt,
} from './lock-override-store';

/** "Aug 2026" / "Aug 2026 and Sep 2026" — the closed period(s) the write touches. */
function namePeriods(periods: string[]): string {
  const names = periods.map(periodDisplayLabel).filter(Boolean);
  if (names.length === 0) return 'a closed period';
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function OverrideForm({ prompt, onResolve }: { prompt: OverridePrompt; onResolve: (reason: string | null) => void }) {
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const descId = useId();
  const reasonId = useId();
  const helpId = useId();
  const [reason, setReason] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);

  // Validate on what the SERVER will actually receive (header-safe), not the raw textarea value.
  const clean = sanitizeOverrideReason(reason);
  const reasonOk = clean.length >= OVERRIDE_REASON_MIN;
  const canSubmit = reasonOk && acknowledged;
  const periodsText = namePeriods(prompt.periods);

  return (
    <DialogContent
      className="rounded-3xl max-w-md max-h-[85vh] overflow-y-auto"
      aria-describedby={descId}
      onOpenAutoFocus={(e) => {
        e.preventDefault();
        reasonRef.current?.focus();
      }}
    >
      <DialogHeader>
        <DialogTitle className="text-xl font-black flex items-center gap-2">
          <Lock className="h-5 w-5 text-destructive" aria-hidden />
          Change a closed period?
        </DialogTitle>
        <DialogDescription id={descId} className="text-sm text-muted-foreground">
          {prompt.message}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 py-2">
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 px-3 py-3 text-xs text-amber-500" role="note">
          <p className="font-bold">Closed {prompt.periods.length > 1 ? 'periods' : 'period'}: {periodsText}</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor={reasonId} className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
            Reason <span className="text-destructive">*</span>
          </Label>
          <Textarea
            id={reasonId}
            ref={reasonRef}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            aria-describedby={helpId}
            aria-required
            aria-invalid={reason.length > 0 && !reasonOk}
            maxLength={OVERRIDE_REASON_MAX}
            placeholder="e.g. Fuel receipt for 12 Aug was entered against the wrong van"
            className="rounded-xl min-h-24"
          />
          <div className="flex items-start justify-between gap-3 text-xs text-muted-foreground">
            <p id={helpId}>Recorded in the audit trail and counted against the period.</p>
            <p
              className={cn('shrink-0 tabular-nums', reason.length > 0 && !reasonOk && 'text-destructive')}
              aria-live="polite"
            >
              {clean.length}/{OVERRIDE_REASON_MIN} min
            </p>
          </div>
        </div>

        <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-border/50 bg-muted/20 px-3 py-2.5 text-sm">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
            className="mt-0.5 h-5 w-5 shrink-0 rounded accent-destructive cursor-pointer"
          />
          <span className="font-medium">I understand this changes a closed accounting period</span>
        </label>
      </div>

      <DialogFooter className="gap-2">
        <Button variant="ghost" onClick={() => onResolve(null)} className="min-h-11">
          Cancel
        </Button>
        <Button
          variant="destructive"
          disabled={!canSubmit}
          onClick={() => canSubmit && onResolve(clean)}
          className="rounded-xl font-bold min-h-11"
        >
          Override and save
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

/**
 * The one override dialog. Renders the head of the store's queue; each prompt
 * gets a fresh form (keyed by id) so a queued second failure never inherits the
 * first one's reason / acknowledgement. Cancel / Escape / overlay = reject-the-original.
 */
export function LockOverrideDialog() {
  const active = useLockOverrideStore((s) => s.queue[0]);
  const resolveActive = useLockOverrideStore((s) => s.resolveActive);

  return (
    <Dialog open={!!active} onOpenChange={(open) => { if (!open) resolveActive(null); }}>
      {active && <OverrideForm key={active.id} prompt={active} onResolve={resolveActive} />}
    </Dialog>
  );
}
