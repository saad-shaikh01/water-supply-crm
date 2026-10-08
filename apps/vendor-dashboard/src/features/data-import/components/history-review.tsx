'use client';

import { useState } from 'react';
import { AlertTriangle, ArrowLeft, Download, Info, Loader2, Search, XCircle } from 'lucide-react';
import {
  Button, Card, CardContent, Input, cn,
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@water-supply-crm/ui';
import type { ImportDetail, RowsQuery, VoucherNormalized } from '../api/data-import.api';
import { DATA_IMPORT_PERMISSIONS } from '../constants';
import { useCan } from '../../authz/hooks/use-can';
import { downloadReport, importErrorOf, useCancelImport, useExecuteImport, useImportRows } from '../hooks/use-data-import';
import { RowOutcomeBadge, rupees, rupeesFromPaise } from './format';

type Tab = 'all' | 'create' | 'skipped' | 'errors' | 'warnings';
const TABS: { key: Tab; label: string; filter: RowsQuery }[] = [
  { key: 'all', label: 'All', filter: {} },
  { key: 'create', label: 'Will be posted', filter: { action: 'CREATE' } },
  { key: 'skipped', label: 'Skipped (already imported / no movement)', filter: { action: 'SKIP_EXISTING' } },
  { key: 'errors', label: 'Errors', filter: { action: 'SKIP_INVALID' } },
  { key: 'warnings', label: 'Warnings', filter: { action: 'CREATE', severity: 'WARNING' } },
];

function Stat({ label, value, tone, testId }: { label: string; value: string; tone?: 'ok' | 'warn' | 'bad'; testId?: string }) {
  return (
    <div className="rounded-2xl border p-4" data-testid={testId}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn('text-2xl font-bold mt-1', tone === 'ok' && 'text-emerald-600', tone === 'warn' && 'text-amber-600', tone === 'bad' && 'text-destructive')}>{value}</p>
    </div>
  );
}

const dateLabel = (d: string | null) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

interface Props {
  detail: ImportDetail;
  onBack: () => void;
  onExecuted: () => void;
  onCancelled: () => void;
}

/** Step 3 for TRANSACTION_HISTORY — the persisted plan the executor will apply, reconciled per customer. */
export function HistoryReviewStep({ detail, onBack, onExecuted, onCancelled }: Props) {
  const { batch, wizard } = detail;
  const plan = batch.summary?.plan;
  const h = plan?.history;
  const canExecute = useCan(DATA_IMPORT_PERMISSIONS.execute);
  const execute = useExecuteImport(batch.id);
  const cancel = useCancelImport();

  const [tab, setTab] = useState<Tab>(plan && plan.create === 0 && plan.skipInvalid > 0 ? 'errors' : 'all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [reviewed, setReviewed] = useState(false);
  const [dupAck, setDupAck] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showUnknown, setShowUnknown] = useState(false);

  const filter = TABS.find((t) => t.key === tab)?.filter ?? {};
  const rows = useImportRows(batch.id, { ...filter, search: search.trim() || undefined, page, limit: 25 });

  if (!plan || !h) return null;
  const dup = wizard?.duplicateOf;
  const blocked = plan.create === 0;
  const ready = reviewed && (!dup || dupAck) && !blocked;
  const posted = h.chargeRows + h.paymentRows;
  const reports = h.reportingMode === 'COUNT_IN_REPORTS';

  const run = async () => {
    setError(null);
    try {
      await execute.mutateAsync({ planHash: batch.planHash as string, acknowledgeWarnings: reviewed, acknowledgeDuplicateFile: dupAck });
      onExecuted();
    } catch (e) {
      const err = importErrorOf(e, 'Could not start the import.');
      setError(err.code === 'PLAN_STALE' ? 'The preview changed. Go back, re-check the mapping and preview again.' : err.message);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border bg-muted/40 p-3 text-sm flex flex-wrap gap-x-6 gap-y-1" data-testid="history-facts">
        <span>Period: <strong>{dateLabel(h.dateFrom)}</strong> → <strong>{dateLabel(h.dateTo)}</strong> (cutover {dateLabel(h.cutoverDate)})</span>
        <span>Used for: <strong>{reports ? 'statements AND reports' : 'customer statements only'}</strong></span>
        <span>Customers in file: <strong>{h.customersInFile.toLocaleString()}</strong></span>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 gap-3">
        <Stat testId="stat-vouchers" label="Vouchers to import" value={plan.create.toLocaleString()} tone={plan.create ? 'ok' : 'bad'} />
        <Stat testId="stat-tx" label="Entries to post (charges + payments)" value={`${h.chargeRows.toLocaleString()} + ${h.paymentRows.toLocaleString()}`} />
        <Stat testId="stat-charged" label="Total charged" value={rupeesFromPaise(h.sumChargePaise)} />
        <Stat testId="stat-paid" label="Total received" value={rupeesFromPaise(h.sumPaidPaise)} />
        <Stat testId="stat-customers" label="Customers to import" value={h.customersToImport.toLocaleString()} tone={h.customersToImport ? 'ok' : 'bad'} />
        <Stat testId="stat-blocked" label="Customers blocked (balance mismatch / error)" value={h.customersBlocked.toLocaleString()} tone={h.customersBlocked ? 'bad' : undefined} />
        <Stat testId="stat-unknown" label="Unknown customer codes" value={h.unknownCodes.toLocaleString()} tone={h.unknownCodes ? 'warn' : undefined} />
        <Stat testId="stat-already" label="Already imported earlier" value={h.alreadyImported.toLocaleString()} />
        <Stat label="No movement (skipped)" value={h.noMovement.toLocaleString()} />
        <Stat label="After cutover (not imported)" value={h.afterCutover.toLocaleString()} tone={h.afterCutover ? 'warn' : undefined} />
        <Stat label="Bottles out / in" value={`${h.bottlesOut.toLocaleString()} / ${h.bottlesIn.toLocaleString()}`} />
        <Stat label="Rows with warnings" value={plan.rowsWithWarnings.toLocaleString()} tone={plan.rowsWithWarnings ? 'warn' : undefined} />
      </div>

      {h.notices.length > 0 && (
        <div className="space-y-2">
          {h.notices.map((n) => (
            <div key={n} className="flex items-start gap-2 rounded-xl bg-amber-500/10 text-amber-800 dark:text-amber-300 p-3 text-sm">
              <Info className="h-4 w-4 mt-0.5 shrink-0" /> <span>{n}</span>
            </div>
          ))}
        </div>
      )}

      {h.customersBlocked > 0 && (
        <Card className="rounded-3xl border-destructive/30" data-testid="mismatch-card">
          <CardContent className="p-4 sm:p-6 space-y-3">
            <p className="font-semibold text-destructive flex items-center gap-2"><XCircle className="h-4 w-4" /> {h.customersBlocked.toLocaleString()} customer{h.customersBlocked === 1 ? '' : 's'} skipped — nothing is changed for them</p>
            <p className="text-xs text-muted-foreground">
              The file’s last running balance must equal what the customer already owes at the cutover date. A partial or mismatching history would make their statement wrong, so none of their rows are imported. Fix the file (or the customer’s opening balance) and import again.
            </p>
            {h.mismatches.length > 0 && (
              <div className="overflow-x-auto rounded-xl border max-h-64">
                <Table>
                  <TableHeader><TableRow><TableHead>Customer code</TableHead><TableHead>What</TableHead><TableHead className="text-right">In the system at cutover</TableHead><TableHead className="text-right">File ends with</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {h.mismatches.map((m) => (
                      <TableRow key={`${m.code}-${m.kind}`}>
                        <TableCell className="font-medium">{m.code}</TableCell>
                        <TableCell>{m.kind === 'MONEY' ? 'Balance' : 'Bottles'}</TableCell>
                        <TableCell className="text-right">{m.expected === null ? '—' : m.kind === 'MONEY' ? rupees(m.expected) : m.expected}</TableCell>
                        <TableCell className="text-right">{m.file === null ? '—' : m.kind === 'MONEY' ? rupees(m.file) : m.file}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            {h.customersBlocked > h.mismatches.length && <p className="text-xs text-muted-foreground">Showing the first {h.mismatches.length}. The full list is in the downloadable report.</p>}
          </CardContent>
        </Card>
      )}

      {h.unknownCodes > 0 && (
        <Card className="rounded-3xl border-amber-500/30" data-testid="unknown-card">
          <CardContent className="p-4 sm:p-6 space-y-2">
            <p className="font-semibold text-amber-700 dark:text-amber-400">{h.unknownCodes.toLocaleString()} customer code{h.unknownCodes === 1 ? '' : 's'} in the file do not exist in the system — their rows are skipped</p>
            <button type="button" className="text-xs underline text-muted-foreground" onClick={() => setShowUnknown((v) => !v)}>{showUnknown ? 'Hide' : 'Show'} the codes</button>
            {showUnknown && <p className="text-xs break-words">{h.unknownCodeList.join(', ')}{h.unknownCodes > h.unknownCodeList.length ? ' …' : ''}</p>}
          </CardContent>
        </Card>
      )}

      <Card className="rounded-3xl">
        <CardContent className="p-4 sm:p-6 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {TABS.map((t) => (
              <button
                key={t.key} type="button" onClick={() => { setTab(t.key); setPage(1); }}
                className={cn('rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors', tab === t.key ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/70')}
              >
                {t.label}
              </button>
            ))}
            <div className="relative ml-auto w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input className="h-9 rounded-full pl-9" placeholder="Search customer code" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Row</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Voucher</TableHead>
                  <TableHead className="text-right">Filled / Empty</TableHead>
                  <TableHead className="text-right">Charge</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead className="text-right">Balance after</TableHead>
                  <TableHead>Outcome</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.isLoading && (
                  <TableRow><TableCell colSpan={10} className="text-center py-10 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin inline mr-2" />Loading rows…</TableCell></TableRow>
                )}
                {rows.data?.data.length === 0 && (
                  <TableRow><TableCell colSpan={10} className="text-center py-10 text-muted-foreground">No rows match.</TableCell></TableRow>
                )}
                {rows.data?.data.map((r) => {
                  const n = r.normalized as unknown as VoucherNormalized | null;
                  const raw = Object.values(r.raw)[0];
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="text-muted-foreground">{r.rowNumber}</TableCell>
                      <TableCell className="font-medium">{n?.customerCode ?? String(raw ?? '—')}</TableCell>
                      <TableCell className="whitespace-nowrap">{n?.date ?? '—'}</TableCell>
                      <TableCell>{n?.voucher ?? '—'}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">{n ? `${n.filled} / ${n.empty}` : '—'}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">{n ? rupees(n.charge) : '—'}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">{n ? rupees(n.paid) : '—'}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">{n?.outstandingAfter != null ? rupees(n.outstandingAfter) : '—'}</TableCell>
                      <TableCell><RowOutcomeBadge action={r.action} result={r.result} /></TableCell>
                      <TableCell className="max-w-[360px]">
                        <ul className="space-y-0.5">
                          {(r.issues ?? []).map((i, idx) => (
                            <li key={idx} className={cn('text-xs flex items-start gap-1', i.severity === 'ERROR' ? 'text-destructive' : 'text-amber-600 dark:text-amber-400')}>
                              {i.severity === 'ERROR' ? <XCircle className="h-3 w-3 mt-0.5 shrink-0" /> : <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />}
                              <span>{i.message}</span>
                            </li>
                          ))}
                        </ul>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {rows.data && rows.data.meta.totalPages > 1 && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{rows.data.meta.total.toLocaleString()} rows · page {page} of {rows.data.meta.totalPages.toLocaleString()}</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="rounded-full" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
                <Button size="sm" variant="outline" className="rounded-full" disabled={page >= rows.data.meta.totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-3xl border-primary/30">
        <CardContent className="p-4 sm:p-6 space-y-4">
          {blocked ? (
            <p className="text-sm text-destructive font-medium">
              Nothing can be imported — {h.alreadyImported > 0 ? 'every voucher in this file was already imported.' : 'no new vouchers for matching customers. Fix the problems above (download the report) or go back to the mapping.'}
            </p>
          ) : (
            <>
              <p className="text-sm">
                You are about to add <strong>{posted.toLocaleString()} entries</strong> ({plan.create.toLocaleString()} vouchers) to the history of <strong>{h.customersToImport.toLocaleString()} customers</strong>:{' '}
                <strong>{rupeesFromPaise(h.sumChargePaise)}</strong> charged and <strong>{rupeesFromPaise(h.sumPaidPaise)}</strong> received.
                {' '}Customers’ <strong>current balances and bottle balances are not changed</strong>.{' '}
                {reports
                  ? 'These entries WILL be counted in sales / received reports for their dates.'
                  : 'Sales, P&L, dashboard and analytics are not affected — the history only appears on statements and the customer ledger.'}
              </p>
              {dup && (
                <label className="flex items-start gap-2 text-sm rounded-xl bg-amber-500/10 p-3">
                  <input type="checkbox" className="h-4 w-4 mt-0.5" checked={dupAck} onChange={(e) => setDupAck(e.target.checked)} />
                  <span>This exact file was already imported{dup.createdByName ? ` by ${dup.createdByName}` : ''}{dup.completedAt ? ` on ${new Date(dup.completedAt).toLocaleDateString()}` : ''}. Import it again anyway (vouchers already imported are skipped, never duplicated).</span>
                </label>
              )}
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4 mt-0.5" data-testid="confirm-reviewed" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />
                <span>I reviewed the totals{plan.rowsWithWarnings ? ' and the warnings' : ''}{h.customersBlocked ? ', and understand the blocked customers are skipped' : ''}, and want to import this history.</span>
              </label>
            </>
          )}
          {error && <p className="text-sm text-destructive font-medium">{error}</p>}
          {!canExecute && !blocked && <p className="text-xs text-muted-foreground">Only an admin can confirm an import. You can prepare it and ask an admin to open this page and press Import.</p>}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" className="rounded-full gap-2" onClick={onBack}><ArrowLeft className="h-4 w-4" /> Back to mapping</Button>
              <Button variant="outline" className="rounded-full gap-2" onClick={() => downloadReport(batch.id)}><Download className="h-4 w-4" /> Download report</Button>
              <Button variant="ghost" className="rounded-full text-destructive" disabled={cancel.isPending} onClick={() => cancel.mutate(batch.id, { onSuccess: onCancelled })}>Cancel import</Button>
            </div>
            {canExecute && !blocked && (
              <Button className="rounded-full px-6 gap-2" data-testid="import-history-btn" disabled={!ready || execute.isPending} onClick={run}>
                {execute.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Import {plan.create.toLocaleString()} vouchers
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
