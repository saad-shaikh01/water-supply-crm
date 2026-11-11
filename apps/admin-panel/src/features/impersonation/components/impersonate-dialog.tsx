'use client';

import { useEffect, useState } from 'react';
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Label, Textarea } from '@water-supply-crm/ui';
import { AlertTriangle } from 'lucide-react';
import { apiErrorMessage } from '../../../lib/api-error';
import { REASON_MAX, REASON_MIN, TTL_OPTIONS, type ImpersonationMode, type StartImpersonationResult, type TtlMinutes } from '../api/impersonation.api';
import { useStartImpersonation } from '../hooks/use-impersonation';

interface Props {
  vendorId: string;
  vendorName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ImpersonateDialog({ vendorId, vendorName, open, onOpenChange }: Props) {
  const start = useStartImpersonation();
  const [reason, setReason] = useState('');
  const [mode, setMode] = useState<ImpersonationMode>('READ_ONLY');
  const [ttl, setTtl] = useState<TtlMinutes>(30);
  const [result, setResult] = useState<StartImpersonationResult | null>(null);
  const reset = start.reset;

  useEffect(() => {
    if (!open) {
      setReason('');
      setMode('READ_ONLY');
      setTtl(30);
      setResult(null);
      reset();
    }
  }, [open, reset]);

  const trimmed = reason.trim();
  const valid = trimmed.length >= REASON_MIN && trimmed.length <= REASON_MAX;

  const submit = () => {
    if (!valid) return;
    start.mutate(
      { vendorId, reason: trimmed, mode, ttlMinutes: ttl },
      {
        onSuccess: (r) => {
          setResult(r);
          // The one-time code is valid for 60s; open the handoff straight away (link below is the fallback).
          window.open(r.handoffUrl, '_blank', 'noopener');
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Impersonate {vendorName}</DialogTitle>
          <DialogDescription>Opens the vendor dashboard signed in as this vendor&apos;s admin.</DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-3" data-testid="impersonation-started">
            <p className="text-sm">
              Session started for <strong>{result.target.name}</strong> ({result.target.email}). It expires {new Date(result.expiresAt).toLocaleTimeString()}.
            </p>
            <p className="text-sm text-muted-foreground">If the vendor dashboard did not open, use the link below. It works once and expires in 60 seconds.</p>
            <a
              href={result.handoffUrl}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="handoff-link"
              className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
            >
              Open vendor dashboard
            </a>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <div role="note" className="flex gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <p>
                Everything you do is recorded in the audit log under your name and visible to the vendor. Passwords, user management and destructive actions are always blocked.
              </p>
            </div>

            <div className="space-y-1">
              <Label htmlFor="imp-reason">Reason (required, min {REASON_MIN} characters)</Label>
              <Textarea id="imp-reason" value={reason} maxLength={REASON_MAX} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Support ticket 123: vendor cannot see today's delivery sheet" />
              {reason.length > 0 && trimmed.length < REASON_MIN && (
                <p role="alert" className="text-xs text-destructive">
                  Enter at least {REASON_MIN} characters.
                </p>
              )}
            </div>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Mode</legend>
              <label className="flex items-start gap-2 text-sm">
                <input type="radio" name="imp-mode" value="READ_ONLY" checked={mode === 'READ_ONLY'} onChange={() => setMode('READ_ONLY')} className="mt-1" />
                <span>
                  <strong>Read-only</strong> (default): view only, every change is rejected.
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input type="radio" name="imp-mode" value="SUPPORT" checked={mode === 'SUPPORT'} onChange={() => setMode('SUPPORT')} className="mt-1" />
                <span>
                  <strong>Support</strong>: can also make changes on the vendor&apos;s behalf.
                </span>
              </label>
            </fieldset>

            <div className="space-y-1">
              <Label htmlFor="imp-ttl">Duration</Label>
              <select id="imp-ttl" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={ttl} onChange={(e) => setTtl(Number(e.target.value) as TtlMinutes)}>
                {TTL_OPTIONS.map((m) => (
                  <option key={m} value={m}>
                    {m} minutes
                  </option>
                ))}
              </select>
            </div>

            {start.isError && (
              <p role="alert" className="text-sm text-destructive">
                {apiErrorMessage(start.error, 'Could not start the session.')}
              </p>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!valid || start.isPending}>
                {start.isPending ? 'Starting...' : 'Start impersonation'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
