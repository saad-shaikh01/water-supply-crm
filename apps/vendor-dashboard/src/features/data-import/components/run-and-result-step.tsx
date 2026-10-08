'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Loader2, RotateCcw, Undo2, Users } from 'lucide-react';
import {
  Button, Card, CardContent, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow, cn,
} from '@water-supply-crm/ui';
import { toast } from 'sonner';
import type { ImportBatch, ImportDetail, RevertPreview } from '../api/data-import.api';
import { DATA_IMPORT_PERMISSIONS } from '../constants';
import { useCan } from '../../authz/hooks/use-can';
import {
  downloadReport, downloadSource, importErrorOf, isRunning, useExecuteImport, useImportRows, useRevertImport, useRevertPreview,
} from '../hooks/use-data-import';
import { BLOCK_REASON_LABEL, ImportStatusBadge, rupees, rupeesFromPaise } from './format';

/** Step 4 — live progress while the BullMQ job runs. The page polls the batch every 2 s. */
export function ProgressStep({ batch }: { batch: ImportBatch }) {
  const plan = batch.summary?.plan;
  const p = batch.summary?.progress;
  const total = plan?.create ?? 0;
  const done = p ? p.created + p.skipped + p.failed : 0;
  const pct = total ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const reverting = batch.summary?.revert?.state === 'RUNNING';

  return (
    <Card className="rounded-3xl max-w-2xl">
      <CardContent className="p-8 space-y-5 text-center">
        <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto" />
        <div>
          <p className="text-lg font-bold">{reverting ? 'Reverting the import…' : batch.status === 'QUEUED' ? 'Waiting to start…' : 'Importing your customers…'}</p>
          <p className="text-sm text-muted-foreground">You can leave this page — the import keeps running in the background.</p>
        </div>
        {!reverting && (
          <>
            <div className="h-3 rounded-full bg-muted overflow-hidden">
              <div className="h-full bg-primary transition-all duration-500" style={{ width: `${pct}%` }} />
            </div>
            <p className="text-sm font-semibold">{done.toLocaleString()} of {total.toLocaleString()} customers · {pct}%</p>
            {p && p.failed > 0 && <p className="text-xs text-destructive">{p.failed} row(s) failed so far — they can be retried afterwards.</p>}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function RevertDialog({ batch, open, onOpenChange }: { batch: ImportBatch; open: boolean; onOpenChange: (o: boolean) => void }) {
  const preview = useRevertPreview();
  const revert = useRevertImport();
  const [data, setData] = useState<RevertPreview | null>(null);

  // Check every customer once each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setData(null);
    preview.mutate(batch.id, { onSuccess: setData, onError: (e) => toast.error(importErrorOf(e, 'Could not check this import').message) });
  }, [open, batch.id]);

  const close = (o: boolean) => onOpenChange(o);

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="rounded-3xl sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Revert this import?</DialogTitle>
          <DialogDescription>
            Only customers that have not been used since the import are removed. Anyone with deliveries, payments, orders or a changed balance is kept.
          </DialogDescription>
        </DialogHeader>
        {!data ? (
          <div className="py-8 text-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin inline mr-2" />Checking each customer…</div>
        ) : (
          <div className="space-y-3 text-sm">
            <p><strong>{data.revertible.toLocaleString()}</strong> of {data.total.toLocaleString()} customers can be removed.</p>
            {data.blocked.length > 0 && (
              <div className="rounded-xl bg-amber-500/10 p-3 space-y-1">
                <p className="font-semibold text-amber-700 dark:text-amber-400">These will be kept:</p>
                {data.blocked.map((b) => <p key={b.reason}>{b.count.toLocaleString()} — {BLOCK_REASON_LABEL[b.reason] ?? b.message}</p>)}
              </div>
            )}
          </div>
        )}
        <DialogFooter className="gap-2">
          <Button variant="outline" className="rounded-full" onClick={() => close(false)}>Keep import</Button>
          <Button
            variant="destructive" className="rounded-full" disabled={!data || data.revertible === 0 || revert.isPending}
            onClick={() => revert.mutate(batch.id, { onSuccess: () => close(false), onError: (e) => toast.error(importErrorOf(e, 'Could not start the revert').message) })}
          >
            {revert.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
            Remove {data?.revertible.toLocaleString() ?? ''} customers
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Step 5 — outcome, failed rows, report, resume, safe revert. Also the read-only history view. */
export function ResultStep({ detail }: { detail: ImportDetail }) {
  const { batch } = detail;
  const canExecute = useCan(DATA_IMPORT_PERMISSIONS.execute);
  const canRevert = useCan(DATA_IMPORT_PERMISSIONS.revert);
  const resume = useExecuteImport(batch.id);
  const [revertOpen, setRevertOpen] = useState(false);

  const p = batch.summary?.progress;
  const plan = batch.summary?.plan;
  const rv = batch.summary?.revert;
  const failedRows = useImportRows(batch.id, { result: 'FAILED', limit: 50 }, !!p && p.failed > 0);
  const keptRows = useImportRows(batch.id, { result: 'REVERT_SKIPPED', limit: 50 }, rv?.state === 'DONE' && (rv.skipped ?? 0) > 0);

  const interrupted = batch.status === 'FAILED';
  // Rows that failed while the rest of the import succeeded can be retried the same way.
  const retryable = interrupted || (batch.status === 'COMPLETED_WITH_ERRORS' && (p?.failed ?? 0) > 0);
  const finished = ['COMPLETED', 'COMPLETED_WITH_ERRORS', 'PARTIALLY_REVERTED'].includes(batch.status);
  const created = (p?.created ?? 0) - (rv?.reverted ?? 0);

  return (
    <div className="space-y-6">
      <Card className="rounded-3xl">
        <CardContent className="p-6 space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            {interrupted ? <AlertTriangle className="h-8 w-8 text-destructive" /> : <CheckCircle2 className={cn('h-8 w-8', batch.status === 'COMPLETED' ? 'text-emerald-600' : 'text-amber-600')} />}
            <div>
              <div className="text-xl font-bold flex items-center gap-2">{batch.sourceFileName} <ImportStatusBadge status={batch.status} /></div>
              <p className="text-xs text-muted-foreground">
                Uploaded by {batch.createdByName ?? 'unknown'} · {new Date(batch.createdAt).toLocaleString()}
                {batch.completedAt ? ` · finished ${new Date(batch.completedAt).toLocaleString()}` : ''}
              </p>
            </div>
          </div>

          {interrupted && (
            <div className="rounded-xl bg-destructive/10 text-destructive p-3 text-sm">
              {batch.errorMessage ?? 'The import was interrupted.'} Customers already created are kept; Resume finishes the rest without creating anything twice.
            </div>
          )}

          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="rounded-2xl border p-4"><p className="text-xs text-muted-foreground">Customers created</p><p className="text-2xl font-bold text-emerald-600">{Math.max(0, created).toLocaleString()}</p></div>
            <div className="rounded-2xl border p-4"><p className="text-xs text-muted-foreground">Skipped — already exist</p><p className="text-2xl font-bold">{(plan?.skipExisting ?? 0).toLocaleString()}</p></div>
            <div className="rounded-2xl border p-4"><p className="text-xs text-muted-foreground">Skipped — errors</p><p className="text-2xl font-bold">{(plan?.skipInvalid ?? 0).toLocaleString()}</p></div>
            <div className="rounded-2xl border p-4"><p className="text-xs text-muted-foreground">Failed</p><p className={cn('text-2xl font-bold', (p?.failed ?? 0) > 0 && 'text-destructive')}>{(p?.failed ?? 0).toLocaleString()}</p></div>
            <div className="rounded-2xl border p-4"><p className="text-xs text-muted-foreground">Opening balance imported</p><p className="text-2xl font-bold">{plan ? rupeesFromPaise(plan.sumOpeningBalancePaise) : '—'}</p></div>
          </div>

          {rv?.state === 'DONE' && (
            <div className="rounded-xl bg-muted p-3 text-sm">
              Reverted: <strong>{(rv.reverted ?? 0).toLocaleString()}</strong> customers removed
              {(rv.skipped ?? 0) > 0 && <>, <strong>{(rv.skipped ?? 0).toLocaleString()}</strong> kept ({Object.entries(rv.byReason ?? {}).map(([k, n]) => `${n} ${BLOCK_REASON_LABEL[k] ?? k}`).join('; ')})</>}.
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {(finished || interrupted) && (
              <Button asChild className="rounded-full gap-2"><Link href="/dashboard/customers"><Users className="h-4 w-4" /> View customers</Link></Button>
            )}
            <Button variant="outline" className="rounded-full gap-2" onClick={() => downloadReport(batch.id)}><Download className="h-4 w-4" /> Download report</Button>
            <Button variant="outline" className="rounded-full gap-2" onClick={() => downloadSource(batch.id)}><FileSpreadsheet className="h-4 w-4" /> Original file</Button>
            {retryable && canExecute && (
              <Button
                className="rounded-full gap-2" disabled={resume.isPending}
                onClick={() => resume.mutate({ planHash: batch.planHash ?? '', acknowledgeWarnings: true, acknowledgeDuplicateFile: true }, { onError: (e) => toast.error(importErrorOf(e, 'Could not resume').message) })}
              >
                {resume.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />} {interrupted ? 'Resume import' : 'Retry failed rows'}
              </Button>
            )}
            {finished && canRevert && !isRunning(batch) && (created > 0 || batch.status === 'COMPLETED_WITH_ERRORS') && (
              <Button variant="outline" className="rounded-full gap-2 text-destructive" onClick={() => setRevertOpen(true)}><Undo2 className="h-4 w-4" /> Revert this import</Button>
            )}
          </div>
        </CardContent>
      </Card>

      {[{ title: 'Rows that failed', rows: failedRows.data?.data }, { title: 'Customers kept when reverting', rows: keptRows.data?.data }].map(
        (blk) =>
          blk.rows &&
          blk.rows.length > 0 && (
            <Card key={blk.title} className="rounded-3xl">
              <CardContent className="p-4 sm:p-6 space-y-3">
                <p className="font-semibold">{blk.title}</p>
                <div className="overflow-x-auto rounded-xl border">
                  <Table>
                    <TableHeader><TableRow><TableHead>Row</TableHead><TableHead>Customer</TableHead><TableHead>Balance</TableHead><TableHead>Why</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {blk.rows.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell>{r.rowNumber}</TableCell>
                          <TableCell className="font-medium">{r.normalized?.name ?? '—'}</TableCell>
                          <TableCell>{r.normalized ? rupees(r.normalized.openingBalance) : '—'}</TableCell>
                          <TableCell className="text-sm">{r.resultMessage ?? r.resultCode}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          ),
      )}

      <RevertDialog batch={batch} open={revertOpen} onOpenChange={setRevertOpen} />
    </div>
  );
}
