'use client';

import { useMemo, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button, Label, Skeleton, Textarea,
} from '@water-supply-crm/ui';
import { CheckCircle2, Loader2, Lock, XCircle } from 'lucide-react';
import { useForceCloseBulk, useStaleOpenSheets } from '../../hooks/use-daily-sheets';

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * Bulk variant of the Close Stale Sheet tool: lists every OPEN sheet from a
 * previous day (route + walk-in) and force-closes the selected ones, each with
 * its own expected cash hand-in. For a different cash figure on one sheet, use
 * that sheet's own Close Stale Sheet dialog instead.
 */
export function ForceCloseBulkDialog({ open, onClose }: Props) {
  const { data: sheets, isLoading } = useStaleOpenSheets(open);
  const { mutate: closeBulk, isPending, data: result, reset } = useForceCloseBulk();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState('');

  const rows = useMemo(() => sheets ?? [], [sheets]);
  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const handleClose = () => { setSelected(new Set()); setReason(''); reset(); onClose(); };
  const reasonOk = reason.trim().length >= 5;
  const outcome = new Map((result?.results ?? []).map((r) => [r.sheetId, r]));

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="rounded-3xl max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <Lock className="h-5 w-5 text-destructive" />
            Close Stale Sheets
          </DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          Open sheets from previous days. Pending deliveries are cancelled, recorded ones are kept, and each sheet is closed with its
          expected cash hand-in. The end-of-day vehicle check is waived and bottle counts are accepted as recorded.
        </p>

        <div className="max-h-72 overflow-y-auto space-y-2">
          {isLoading && Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-xl" />)}
          {!isLoading && rows.length === 0 && (
            <p className="text-center text-muted-foreground py-8">No stale open sheets</p>
          )}
          {rows.map((s) => {
            const o = outcome.get(s.id);
            return (
              <label key={s.id} className="flex items-center gap-3 rounded-xl border border-border p-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selected.has(s.id)}
                  disabled={isPending || o?.ok}
                  onChange={() => toggle(s.id)}
                />
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-semibold">
                    {new Date(s.date).toLocaleDateString('en-GB', { timeZone: 'Asia/Karachi' })}
                    {s.kind === 'WALK_IN' ? ' · Walk-in' : s.van?.plateNumber ? ` · ${s.van.plateNumber}` : ''}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {s.itemCounts?.completed ?? 0} recorded · {s.itemCounts?.pending ?? 0} pending
                    {s.tripState?.hasActiveTrip && ' · trip active'}
                  </p>
                </div>
                {o?.ok && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
                {o && !o.ok && (
                  <span className="flex items-center gap-1 text-xs text-destructive">
                    <XCircle className="h-4 w-4" /> {o.error}
                  </span>
                )}
              </label>
            );
          })}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="bulk-force-close-reason">Reason (required, saved in the audit log)</Label>
          <Textarea
            id="bulk-force-close-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Sheets were never closed in September; entries verified"
            className="rounded-xl"
            rows={2}
          />
        </div>

        {result && (
          <p className="text-sm font-semibold">
            Closed {result.closed} of {result.total}
            {result.failed > 0 && ` — ${result.failed} failed (see above)`}
          </p>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" className="rounded-xl" onClick={handleClose} disabled={isPending}>
            {result ? 'Done' : 'Cancel'}
          </Button>
          <Button
            variant="destructive"
            className="rounded-xl font-bold"
            disabled={isPending || selected.size === 0 || !reasonOk}
            onClick={() => closeBulk({ sheetIds: Array.from(selected), reason: reason.trim() })}
          >
            {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Close {selected.size} sheet{selected.size === 1 ? '' : 's'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
