'use client';

import { useEffect, useId, useState } from 'react';
import { FileText, Loader2 } from 'lucide-react';
import { useQueryState, parseAsString } from 'nuqs';
import {
  Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, Label,
} from '@water-supply-crm/ui';
import { pktToday } from '../../../lib/date-pkt';
import { resolveCashLedgerRange } from '../hooks/use-van-cash-ledger';
import { useCashLedgerExporting, useDownloadDailyReportPdf } from '../hooks/use-cash-ledger-export';

const YMD = /^\d{4}-\d{2}-\d{2}$/;

interface DailyReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * "Daily cash report (PDF)" — pick one PKT day (never in the future) and
 * download that day's cash statement. Follows the page's van filter.
 */
export function DailyReportDialog({ open, onOpenChange }: DailyReportDialogProps) {
  const dateId = useId();
  const [vanId] = useQueryState('vanId', parseAsString.withDefault(''));
  const [from] = useQueryState('from', parseAsString.withDefault(''));
  const [to] = useQueryState('to', parseAsString.withDefault(''));
  const range = resolveCashLedgerRange(from, to);

  const exporting = useCashLedgerExporting();
  const download = useDownloadDailyReportPdf();
  const [date, setDate] = useState('');

  // Each open starts from the day on screen (single-day range) or today — evaluated at open time so a
  // tab left open overnight never offers yesterday as "today".
  useEffect(() => {
    if (!open) return;
    const today = pktToday();
    const single = range.from && range.from === range.to ? range.from : null;
    setDate(single && single <= today ? single : today);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const today = pktToday();
  const valid = YMD.test(date) && date <= today;
  const busy = download.isPending || exporting;

  const submit = () => {
    if (!valid || busy) return;
    download.mutate(
      { date, vanId: vanId || undefined },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!download.isPending) onOpenChange(next); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" aria-hidden />
            Daily cash report
          </DialogTitle>
          <DialogDescription>
            Download one day&apos;s cash statement and entries as a PDF.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="space-y-3"
        >
          <div className="space-y-1.5">
            <Label htmlFor={dateId}>Report date</Label>
            <Input
              id={dateId}
              type="date"
              value={date}
              max={today}
              required
              onChange={(e) => setDate(e.target.value)}
              aria-invalid={!!date && !valid}
              className="h-11 sm:h-10"
            />
            {!!date && date > today && (
              <p role="alert" className="text-xs text-destructive">
                Pick today or an earlier day — reports can&apos;t be generated for a future date.
              </p>
            )}
          </div>

          {vanId && (
            <p className="rounded-lg border border-border/50 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              Uses the current van filter — the report covers the selected van only.
            </p>
          )}

          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-11 sm:h-10"
              disabled={download.isPending}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" className="h-11 gap-2 sm:h-10" disabled={!valid || busy}>
              {download.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <FileText className="h-4 w-4" aria-hidden />
              )}
              Download PDF
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
