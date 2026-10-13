'use client';

import { Fragment, useState } from 'react';
import { AlertTriangle, ArrowLeft, Download, Loader2, Pencil, Search, XCircle } from 'lucide-react';
import {
  Button, Card, CardContent, Input, cn,
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@water-supply-crm/ui';
import type { ImportDetail, ImportRow, RowsQuery } from '../api/data-import.api';
import { DATA_IMPORT_PERMISSIONS } from '../constants';
import { useCan } from '../../authz/hooks/use-can';
import { downloadReport, importErrorOf, useCancelImport, useExecuteImport, useImportRows, useUpdateImportRow } from '../hooks/use-data-import';
import { RowOutcomeBadge, rupees, rupeesFromPaise } from './format';
import { HistoryReviewStep } from './history-review';

type Tab = 'all' | 'create' | 'exists' | 'errors' | 'warnings';
const TABS: { key: Tab; label: string; filter: RowsQuery }[] = [
  { key: 'all', label: 'All', filter: {} },
  { key: 'create', label: 'Will be created', filter: { action: 'CREATE' } },
  { key: 'exists', label: 'Already exist', filter: { action: 'SKIP_EXISTING' } },
  { key: 'errors', label: 'Errors', filter: { action: 'SKIP_INVALID' } },
  { key: 'warnings', label: 'Warnings', filter: { action: 'CREATE', severity: 'WARNING' } },
];

const FIELD_LABELS: Record<string, string> = { customerCode: 'Customer code', name: 'Name', phone: 'Phone', address: 'Address', isActive: 'Status' };
const SELECT_CLASS = 'h-9 rounded-full border bg-background px-3 text-sm';

/** Inline fix for one row: edits the cells of the uploaded file, then the preview is rebuilt. */
function RowFixer({ row, fields, batchId, onDone }: { row: ImportRow; fields: string[]; batchId: string; onDone: () => void }) {
  const update = useUpdateImportRow(batchId);
  const n = row.normalized;
  const d = row.display;
  const initial: Record<string, string> = {
    customerCode: d?.code ?? n?.customerCode ?? '',
    name: d?.name ?? n?.name ?? '',
    phone: d?.phone ?? (n?.phoneNumber && n.phoneNumber !== '-' ? n.phoneNumber : ''),
    address: n?.address ?? '',
    isActive: d?.isActive === false ? 'Closed' : 'Active',
  };
  const [draft, setDraft] = useState<Record<string, string>>(initial);
  const [err, setErr] = useState<string | null>(null);
  const changed = fields.filter((f) => draft[f] !== initial[f]);

  const save = async () => {
    setErr(null);
    try {
      await update.mutateAsync({ rowId: row.id, values: Object.fromEntries(changed.map((f) => [f, draft[f]])) });
      onDone();
    } catch (e) {
      setErr(importErrorOf(e, 'Could not save the change.').message);
    }
  };

  return (
    <div className="space-y-3 py-1">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {fields.map((f) => (
          <label key={f} className="text-xs text-muted-foreground space-y-1 block">
            {FIELD_LABELS[f] ?? f}
            {f === 'isActive' ? (
              <select className={cn(SELECT_CLASS, 'w-full')} value={draft[f]} onChange={(e) => setDraft({ ...draft, [f]: e.target.value })}>
                <option value="Active">Active</option>
                <option value="Closed">Closed</option>
              </select>
            ) : (
              <Input className="h-9 rounded-full text-foreground" value={draft[f] ?? ''} onChange={(e) => setDraft({ ...draft, [f]: e.target.value })} />
            )}
          </label>
        ))}
      </div>
      {err && <p className="text-xs text-destructive font-medium">{err}</p>}
      <div className="flex gap-2">
        <Button size="sm" className="rounded-full" disabled={!changed.length || update.isPending} onClick={save}>
          {update.isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}Save &amp; re-check
        </Button>
        <Button size="sm" variant="ghost" className="rounded-full" onClick={onDone}>Cancel</Button>
      </div>
    </div>
  );
}

function Stat({ label, value, tone, hint }: { label: string; value: string; tone?: 'ok' | 'warn' | 'bad'; hint?: string }) {
  return (
    <div className="rounded-2xl border p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn('text-2xl font-bold mt-1', tone === 'ok' && 'text-emerald-600', tone === 'warn' && 'text-amber-600', tone === 'bad' && 'text-destructive')}>{value}</p>
      {hint && <p className="text-xs text-muted-foreground mt-1 break-words">{hint}</p>}
    </div>
  );
}

interface Props {
  detail: ImportDetail;
  onBack: () => void;
  onExecuted: () => void;
  onCancelled: () => void;
}

/** Step 3 — the preview. Everything shown here is the persisted plan the executor will apply. */
export function ReviewStep(props: Props) {
  return props.detail.batch.entity === 'TRANSACTION_HISTORY' ? <HistoryReviewStep {...props} /> : <CustomerReviewStep {...props} />;
}

function CustomerReviewStep({ detail, onBack, onExecuted, onCancelled }: Props) {
  const { batch, wizard } = detail;
  const plan = batch.summary?.plan;
  const canExecute = useCan(DATA_IMPORT_PERMISSIONS.execute);
  const execute = useExecuteImport(batch.id);
  const cancel = useCancelImport();

  const [tab, setTab] = useState<Tab>(plan && plan.create === 0 && plan.skipInvalid > 0 ? 'errors' : 'all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<NonNullable<RowsQuery['sort']>>('row');
  const [status, setStatus] = useState<'all' | 'active' | 'closed'>('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [dupAck, setDupAck] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filter = TABS.find((t) => t.key === tab)?.filter ?? {};
  const rows = useImportRows(batch.id, { ...filter, search: search.trim() || undefined, sort, status: status === 'all' ? undefined : status, page, limit: 25 });

  if (!plan) return null;
  const dup = wizard?.duplicateOf;
  const blocked = plan.create === 0;
  const ready = reviewed && (!dup || dupAck) && !blocked;

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
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        <Stat label="Will be created" value={plan.create.toLocaleString()} tone={plan.create ? 'ok' : 'bad'} />
        <Stat label="Already exist (skipped)" value={plan.skipExisting.toLocaleString()} />
        <Stat label="Rows with errors (skipped)" value={plan.skipInvalid.toLocaleString()} tone={plan.skipInvalid ? 'bad' : undefined} />
        <Stat label="Created with warnings" value={plan.rowsWithWarnings.toLocaleString()} tone={plan.rowsWithWarnings ? 'warn' : undefined} />
        <Stat label="Total opening balance" value={rupeesFromPaise(plan.sumOpeningBalancePaise)} />
        <Stat label="Total bottles with customers" value={plan.sumOpeningBottles.toLocaleString()} />
      </div>

      {plan.schedule && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat label="Customers with a delivery schedule" value={plan.schedule.customersWithSchedule.toLocaleString()} />
          <Stat label="Vans to be created" value={plan.schedule.vansToCreate.length.toLocaleString()} hint={plan.schedule.vansToCreate.join(', ') || undefined} />
          <Stat label="Existing vans used" value={plan.schedule.vansExisting.toLocaleString()} />
          <Stat label="Routes to be created" value={plan.schedule.routesToCreate.length.toLocaleString()} hint={plan.schedule.routesToCreate.slice(0, 6).join(', ') || undefined} />
        </div>
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
            <select className={cn(SELECT_CLASS, 'ml-auto')} value={status} onChange={(e) => { setStatus(e.target.value as typeof status); setPage(1); }} aria-label="Customer status">
              <option value="all">All statuses</option>
              <option value="active">Active only</option>
              <option value="closed">Closed only</option>
            </select>
            <select className={SELECT_CLASS} value={sort} onChange={(e) => { setSort(e.target.value as typeof sort); setPage(1); }} aria-label="Sort rows">
              <option value="row">File order</option>
              <option value="code">Customer code A→Z</option>
              <option value="code_desc">Customer code Z→A</option>
            </select>
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input className="h-9 rounded-full pl-9" placeholder="Search name, code, phone" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Row</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead className="text-right">Bottles</TableHead>
                  <TableHead>Outcome</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.isLoading && (
                  <TableRow><TableCell colSpan={7} className="text-center py-10 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin inline mr-2" />Loading rows…</TableCell></TableRow>
                )}
                {rows.data?.data.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="text-center py-10 text-muted-foreground">No rows match.</TableCell></TableRow>
                )}
                {rows.data?.data.map((r) => {
                  const n = r.normalized;
                  const raw = Object.values(r.raw)[0];
                  const d = r.display;
                  const canFix = !!rows.data?.editableFields?.length && r.result === 'PENDING' && r.action !== 'SKIP_EXISTING';
                  return (
                    <Fragment key={r.id}>
                    <TableRow>
                      <TableCell className="text-muted-foreground">{r.rowNumber}</TableCell>
                      <TableCell>
                        <p className="font-medium">
                          {n?.name ?? d?.name ?? <span className="text-destructive">No name{raw != null && String(raw) !== '' ? ` ("${String(raw)}")` : ''}</span>}
                          {d?.isActive === false && <span className="ml-2 text-[10px] font-semibold uppercase text-muted-foreground">Closed</span>}
                        </p>
                        <p className="text-xs text-muted-foreground">{n?.customerCode ?? d?.code ?? (n ? 'code auto-generated' : 'no code')}</p>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{(n?.phoneNumber && n.phoneNumber !== '-' ? n.phoneNumber : d?.phone) || <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">{n ? rupees(n.openingBalance) : '—'}</TableCell>
                      <TableCell className="text-right">{n ? n.openingBottles : '—'}</TableCell>
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
                        {canFix && (r.issues?.length ?? 0) > 0 && (
                          <button type="button" className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline" onClick={() => setEditingId(editingId === r.id ? null : r.id)}>
                            <Pencil className="h-3 w-3" /> Fix here
                          </button>
                        )}
                      </TableCell>
                    </TableRow>
                    {editingId === r.id && rows.data?.editableFields && (
                      <TableRow className="bg-muted/30 hover:bg-muted/30">
                        <TableCell colSpan={7}><RowFixer row={r} fields={rows.data.editableFields} batchId={batch.id} onDone={() => setEditingId(null)} /></TableCell>
                      </TableRow>
                    )}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {rows.data && rows.data.meta.totalPages > 1 && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{rows.data.meta.total.toLocaleString()} rows · page {page} of {rows.data.meta.totalPages}</span>
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
            <p className="text-sm text-destructive font-medium">Nothing can be imported — there are no valid new customers in this file. Fix the problems above (download the report) or go back to the mapping.</p>
          ) : (
            <>
              <p className="text-sm">
                You are about to create <strong>{plan.create.toLocaleString()} customers</strong> with opening balances totalling{' '}
                <strong>{rupeesFromPaise(plan.sumOpeningBalancePaise)}</strong> and <strong>{plan.sumOpeningBottles.toLocaleString()} bottles</strong>.
                Existing customers are never changed. This adds balances only — no payments, deliveries or ledger entries are created.
              </p>
              {plan.schedule && (
                <p className="text-sm">
                  It will also create <strong>{plan.schedule.vansToCreate.length} van(s)</strong>
                  {plan.schedule.vansToCreate.length > 0 && <> ({plan.schedule.vansToCreate.slice(0, 8).join(', ')}{plan.schedule.vansToCreate.length > 8 ? '…' : ''})</>},
                  {' '}<strong>{plan.schedule.routesToCreate.length} route(s)</strong> and{' '}
                  <strong>{plan.schedule.scheduleEntries.toLocaleString()} delivery-day assignment(s)</strong> for {plan.schedule.customersWithSchedule.toLocaleString()} customers.
                  New vans have no driver yet — assign one in Vans before the first daily sheet.
                </p>
              )}
              {dup && (
                <label className="flex items-start gap-2 text-sm rounded-xl bg-amber-500/10 p-3">
                  <input type="checkbox" className="h-4 w-4 mt-0.5" checked={dupAck} onChange={(e) => setDupAck(e.target.checked)} />
                  <span>This exact file was already imported{dup.createdByName ? ` by ${dup.createdByName}` : ''}{dup.completedAt ? ` on ${new Date(dup.completedAt).toLocaleDateString()}` : ''}. Import it again anyway (customers that already exist are skipped).</span>
                </label>
              )}
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4 mt-0.5" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />
                <span>I reviewed the totals{plan.rowsWithWarnings ? ' and the warnings' : ''} and want to import these customers.</span>
              </label>
            </>
          )}
          {error && <p className="text-sm text-destructive font-medium">{error}</p>}
          {!canExecute && !blocked && <p className="text-xs text-muted-foreground">Only an admin can confirm an import. You can prepare it and ask an admin to open this page and press Import.</p>}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" className="rounded-full gap-2" onClick={onBack}><ArrowLeft className="h-4 w-4" /> Back to mapping</Button>
              <Button variant="outline" className="rounded-full gap-2" onClick={() => downloadReport(batch.id)}><Download className="h-4 w-4" /> Download report</Button>
              {plan.skipInvalid > 0 && (
                <Button variant="outline" className="rounded-full gap-2 text-destructive" onClick={() => downloadReport(batch.id, 'errors')}><Download className="h-4 w-4" /> Errors only ({plan.skipInvalid.toLocaleString()})</Button>
              )}
              {plan.rowsWithWarnings > 0 && (
                <Button variant="outline" className="rounded-full gap-2 text-amber-600" onClick={() => downloadReport(batch.id, 'warnings')}><Download className="h-4 w-4" /> Warnings only ({plan.rowsWithWarnings.toLocaleString()})</Button>
              )}
              <Button variant="ghost" className="rounded-full text-destructive" disabled={cancel.isPending} onClick={() => cancel.mutate(batch.id, { onSuccess: onCancelled })}>Cancel import</Button>
            </div>
            {canExecute && !blocked && (
              <Button className="rounded-full px-6 gap-2" disabled={!ready || execute.isPending} onClick={run}>
                {execute.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Import {plan.create.toLocaleString()} customers
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
