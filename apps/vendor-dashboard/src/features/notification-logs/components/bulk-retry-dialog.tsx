'use client';

import { useEffect, useState } from 'react';
import { RotateCw } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Button,
} from '@water-supply-crm/ui';
import type { NotificationLogFilters } from '../api/notification-logs.api';
import { useBulkRetry, useBulkRetryPreview, type BulkRetryPreview } from '../hooks/use-notification-logs';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The log page's current filters — "retry all failed" acts on exactly what the user is looking at. */
  filters: NotificationLogFilters;
}

const SKIP_LABELS: [keyof BulkRetryPreview['skipped'], string][] = [
  ['permanent', 'failed for a reason a retry cannot fix (e.g. number not on WhatsApp)'],
  ['alreadyDelivered', 'already delivered by a later send'],
  ['disabled', 'switched off in notification settings'],
  ['duplicate', 'duplicates of another failed send in this list'],
];

export function BulkRetryDialog({ open, onOpenChange, filters }: Props) {
  const preview = useBulkRetryPreview(filters, open);
  const retry = useBulkRetry();
  const [includeLegacy, setIncludeLegacy] = useState(false);

  useEffect(() => {
    if (open) setIncludeLegacy(false);
  }, [open]);

  const data = preview.data;
  const total = data ? data.retryable + (includeLegacy ? data.legacy : 0) : 0;
  const skipped = data ? SKIP_LABELS.filter(([k]) => data.skipped[k] > 0) : [];

  const confirm = () =>
    retry.mutate({ filters, includeLegacy }, { onSuccess: () => onOpenChange(false) });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Retry failed WhatsApp sends</DialogTitle>
          <DialogDescription>
            Only sends that can be re-sent without messaging a customer twice are retried. Everything is based on the filters
            currently applied on this page.
          </DialogDescription>
        </DialogHeader>

        {preview.isLoading || !data ? (
          <div className="h-24 rounded-xl bg-accent/30 animate-pulse" />
        ) : (
          <div className="space-y-3 text-sm">
            <div className="rounded-xl border border-border/50 p-3">
              <div className="text-2xl font-black text-foreground dark:text-white">{data.retryable}</div>
              <div className="text-xs text-muted-foreground">
                failed because the message never reached WhatsApp (network / upload problem) — safe to retry
              </div>
            </div>

            {data.legacy > 0 && (
              <label className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={includeLegacy}
                  onChange={(e) => setIncludeLegacy(e.target.checked)}
                />
                <span className="text-xs">
                  <span className="font-bold text-foreground dark:text-white">Also retry {data.legacy} older failure{data.legacy === 1 ? '' : 's'}</span>
                  <span className="block text-muted-foreground mt-0.5">
                    These were logged before failures were classified, so we cannot prove none of them reached the customer.
                    A customer who already received a message after the failure is skipped automatically.
                  </span>
                </span>
              </label>
            )}

            {skipped.length > 0 && (
              <ul className="text-xs text-muted-foreground space-y-0.5">
                {skipped.map(([k, label]) => (
                  <li key={k}>
                    <span className="font-bold">{data.skipped[k]}</span> not retried — {label}
                  </li>
                ))}
              </ul>
            )}

            {data.capped && (
              <p className="text-xs text-amber-400">More failed sends match than one pass handles — run this again afterwards.</p>
            )}
            {data.retryable + data.legacy === 0 && (
              <p className="text-xs text-muted-foreground">Nothing to retry for the current filters.</p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={retry.isPending}>
            Cancel
          </Button>
          <Button onClick={confirm} disabled={retry.isPending || preview.isLoading || total === 0}>
            <RotateCw className="h-3.5 w-3.5 mr-1.5" />
            {retry.isPending ? 'Queueing...' : `Retry ${total} message${total === 1 ? '' : 's'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
