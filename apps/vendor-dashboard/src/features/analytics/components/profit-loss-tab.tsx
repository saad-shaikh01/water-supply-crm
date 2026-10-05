'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { parseAsString, useQueryState } from 'nuqs';
import {
  Button, Card, CardContent, CardHeader, CardTitle, Skeleton,
  Sheet, SheetContent, SheetHeader, SheetTitle,
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
  cn,
} from '@water-supply-crm/ui';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ChevronDown, ChevronLeft, ChevronRight, Plus, RotateCcw } from 'lucide-react';
import { AddExpenseWizard } from '../../expense-center/wizard/add-expense-wizard';
import {
  PROFIT_LOSS_ADJUSTMENT_KEYS, useProfitLoss, useProfitLossDetails, useProfitLossPayments,
  type ProfitLossAdjustment, type ProfitLossData,
  type ProfitLossDomain, type ProfitLossSummary,
} from '../hooks/use-analytics';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function shift(month: string, delta: number) {
  const [y, m] = month.split('-').map(Number);
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

function monthLabel(month: string, short = false) {
  const [y, m] = month.split('-').map(Number);
  const name = MONTH_NAMES[m - 1];
  return short ? `${name.slice(0, 3)} ${y}` : `${name} ${y}`;
}

function rs(n: number | null | undefined) {
  if (n == null) return '—';
  return `₨${n.toLocaleString('en', { maximumFractionDigits: 0 })}`;
}

function rs2(n: number | null | undefined) {
  if (n == null) return '—';
  return n.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const profitTone = (n: number) => (n >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive');

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="bg-card/40 backdrop-blur-xl border-white/10 rounded-[2rem] min-w-0">
      <CardContent className="p-4 sm:p-6">
        <p className="text-[10px] sm:text-xs text-muted-foreground uppercase tracking-wider sm:tracking-widest font-bold">{label}</p>
        <p className="text-lg sm:text-2xl font-bold mt-1 break-words">{value}</p>
        {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
      </CardContent>
    </Card>
  );
}

function ProfitCard({ label, sub, value }: { label: string; sub: string; value: number }) {
  return (
    <Card className="bg-card/40 backdrop-blur-xl border-white/10 rounded-[2rem] min-w-0">
      <CardContent className="p-4 sm:p-6">
        <p className="text-[10px] sm:text-xs text-muted-foreground uppercase tracking-wider sm:tracking-widest font-bold">{label}</p>
        <p className={cn('text-2xl sm:text-3xl font-black mt-1 break-words', profitTone(value))}>{rs(value)}</p>
        <p className="text-xs text-muted-foreground mt-1">{sub}</p>
      </CardContent>
    </Card>
  );
}

// ── "Cash basis" vs "Actual cost" view ────────────────────────────────────────
// The choice (and which adjustments the owner switched off) survives refresh via localStorage.

type Basis = 'CASH' | 'ACTUAL';
const VIEW_STORAGE_KEY = 'analytics:profit-loss:view:v1';

function usePlView() {
  const [basis, setBasisState] = useState<Basis>('CASH');
  const [off, setOffState] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(VIEW_STORAGE_KEY) ?? 'null');
      if (saved?.basis === 'ACTUAL') setBasisState('ACTUAL');
      if (Array.isArray(saved?.off)) setOffState(saved.off.filter((k: unknown) => typeof k === 'string'));
    } catch {
      // storage unavailable or corrupt — fall back to the cash view
    }
    setHydrated(true);
  }, []);

  const persist = useCallback((nextBasis: Basis, nextOff: string[]) => {
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, JSON.stringify({ basis: nextBasis, off: nextOff }));
    } catch {
      // ignore — the view simply won't persist
    }
  }, []);

  const setBasis = (next: Basis) => { setBasisState(next); persist(next, off); };
  const toggleKey = (key: string) => {
    const next = off.includes(key) ? off.filter((k) => k !== key) : [...off, key];
    setOffState(next);
    persist(basis, next);
  };
  const reset = () => { setBasisState('CASH'); setOffState([]); persist('CASH', []); };

  return { basis, off, hydrated, setBasis, toggleKey, reset };
}

/** The adjustment rows hang off the group's main cost category inside the Expenses table. */
const ADJUSTMENT_HOST_KEY: Record<ProfitLossAdjustment['group'], string> = {
  PLANT: 'BOTTLE_REFILL_PAYMENT',
  CAPS: 'CAPS_PURCHASED',
  SALARY: 'SALARY_SETTLEMENT',
};

function CashViewHint({ data }: { data: ProfitLossData }) {
  const count = data.adjustments.filter((a) => a.amount > 0).length;
  if (count === 0) return null;
  return (
    <p className="text-xs text-muted-foreground">
      {count} cost {count === 1 ? 'item was' : 'items were'} paid in a different month than {count === 1 ? 'it belongs' : 'they belong'} to — switch to{' '}
      <span className="font-semibold">Actual cost</span> to see {monthLabel(data.month)} with {count === 1 ? 'it' : 'them'} moved.
    </p>
  );
}

function ExpenseTable({
  domains, summary, onOpen, actual,
}: {
  domains: ProfitLossDomain[];
  summary: ProfitLossSummary;
  onOpen: (key: string) => void;
  /** Present only in the Actual-cost view: the adjustment checkboxes live inside this table. */
  actual?: { data: ProfitLossData; off: string[]; onToggle: (key: string) => void; onReset: () => void };
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const adjustments = actual ? actual.data.adjustments.filter((a) => a.amount > 0) : [];
  const hostKeys = new Set(adjustments.map((a) => ADJUSTMENT_HOST_KEY[a.group]));
  const visible = domains.filter((d) => d.amount > 0 || d.categories.length > 0);
  // In the Actual view, domains that carry an adjustment open by default so the checkboxes are in sight.
  const isDomainOpen = (d: ProfitLossDomain) => open[d.domain] ?? d.categories.some((c) => hostKeys.has(c.key));

  return (
    <Card className="bg-card/40 backdrop-blur-xl border-white/10 rounded-[2rem]">
      <CardHeader>
        <CardTitle className="text-base font-bold">Expenses by Domain</CardTitle>
        <p className="text-xs text-muted-foreground">
          {actual
            ? 'Actual cost: tick or untick the highlighted rows to move a cost into or out of this month.'
            : 'Click a domain to see its categories, and a category to see every entry.'}
        </p>
        {actual && (
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-sm">
            <span className="text-muted-foreground">
              Cash paid in {monthLabel(actual.data.month, true)}:{' '}
              <span className="font-semibold text-foreground">{rs(summary.totalExpenses - actual.data.adjustmentTotal)}</span>
              <span className="mx-2">→</span>
              Actual cost: <span className="font-black text-foreground">{rs(summary.totalExpenses)}</span>
              <span className="ml-1 text-xs">({actual.data.adjustmentTotal >= 0 ? '+' : '−'}{rs(Math.abs(actual.data.adjustmentTotal))})</span>
            </span>
            <Button variant="ghost" size="sm" onClick={actual.onReset} className="gap-1">
              <RotateCcw className="h-3.5 w-3.5" /> Reset to cash view
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Description</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="text-right">Per Bottle</TableHead>
              <TableHead className="text-right">% of Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground py-8">No expenses recorded this month</TableCell>
              </TableRow>
            )}
            {visible.map((d) => {
              const isOpen = isDomainOpen(d);
              return (
                <Fragment key={d.domain}>
                  <TableRow
                    className="cursor-pointer bg-muted/30 hover:bg-muted/50 font-semibold"
                    onClick={() => setOpen((s) => ({ ...s, [d.domain]: !isOpen }))}
                  >
                    <TableCell>
                      <span className="inline-flex items-center gap-2">
                        <ChevronDown className={cn('h-4 w-4 transition-transform', !isOpen && '-rotate-90')} />
                        {d.label}
                        <span className="text-xs font-normal text-muted-foreground">({d.categories.length})</span>
                      </span>
                    </TableCell>
                    <TableCell className="text-right">{rs(d.amount)}</TableCell>
                    <TableCell className="text-right">{rs2(d.perBottle)}</TableCell>
                    <TableCell className="text-right">{d.percent}%</TableCell>
                  </TableRow>
                  {isOpen && d.categories.map((c) => (
                    <Fragment key={c.key}>
                    <TableRow
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() => onOpen(c.key)}
                    >
                      <TableCell className="pl-10">
                        {c.label}
                        <span className="ml-2 text-xs text-muted-foreground">{c.count} {c.count === 1 ? 'entry' : 'entries'}</span>
                        {!!c.adjustment && (
                          <span className="ml-2 text-xs font-semibold text-amber-600 dark:text-amber-400">
                            {c.adjustment > 0 ? '+' : '−'}{rs(Math.abs(c.adjustment))} adjusted
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">{rs(c.amount)}</TableCell>
                      <TableCell className="text-right">{rs2(c.perBottle)}</TableCell>
                      <TableCell className="text-right">{c.percent}%</TableCell>
                    </TableRow>
                    {actual && adjustments.filter((a) => ADJUSTMENT_HOST_KEY[a.group] === c.key).map((a) => {
                      const checked = !actual.off.includes(a.key);
                      return (
                        <TableRow key={a.key} className="bg-amber-500/5 hover:bg-amber-500/10">
                          <TableCell className="pl-14" colSpan={2}>
                            <label className="flex items-start gap-3 cursor-pointer">
                              <input
                                type="checkbox"
                                className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                                checked={checked}
                                onChange={() => actual.onToggle(a.key)}
                              />
                              <span className="min-w-0">
                                <span className="block text-sm font-medium">{a.label}</span>
                                <span className="block text-xs text-muted-foreground">{a.hint}</span>
                              </span>
                            </label>
                          </TableCell>
                          <TableCell className={cn('text-right font-semibold whitespace-nowrap', a.delta > 0 ? 'text-destructive' : 'text-emerald-600 dark:text-emerald-400', !checked && 'opacity-40 line-through')} colSpan={2}>
                            {a.delta > 0 ? '+' : '−'}{rs(a.amount)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    </Fragment>
                  ))}
                </Fragment>
              );
            })}
            <TableRow className="font-black border-t-2">
              <TableCell>Total Expenses</TableCell>
              <TableCell className="text-right">{rs(summary.totalExpenses)}</TableCell>
              <TableCell className="text-right">{rs2(summary.avgExpensePerBottle)}</TableCell>
              <TableCell className="text-right">100%</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function DetailsSheet({ month, category, onClose }: { month: string; category: string | null; onClose: () => void }) {
  const [page, setPage] = useState(1);
  const { data, isLoading, isFetching } = useProfitLossDetails(month, category, page);

  return (
    <Sheet open={!!category} onOpenChange={(o) => { if (!o) { setPage(1); onClose(); } }}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto bg-background/95 backdrop-blur-xl">
        <SheetHeader className="pb-4 border-b">
          <SheetTitle>{data?.categoryLabel ?? 'Details'} — {monthLabel(month)}</SheetTitle>
          {data && (
            <p className="text-sm text-muted-foreground">
              {data.meta.total} {data.meta.total === 1 ? 'entry' : 'entries'} · Total <span className="font-bold text-foreground">{rs(data.total)}</span>
            </p>
          )}
        </SheetHeader>

        <div className="pt-4 space-y-2">
          {isLoading && Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}
          {data?.rows.length === 0 && <p className="text-center text-muted-foreground py-8">No entries</p>}
          {data?.rows.map((r) => (
            <div key={r.id} className="rounded-xl border border-border p-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate">{r.title}</p>
                {r.subtitle && <p className="text-xs text-muted-foreground truncate">{r.subtitle}</p>}
                <p className="text-xs text-muted-foreground mt-1">
                  {new Date(r.date).toLocaleDateString('en-GB', { timeZone: 'Asia/Karachi' })}
                  {' · '}{r.source}
                  {r.employeeName && ` · ${r.employeeName}`}
                  {r.vanPlateNumber && ` · ${r.vanPlateNumber}`}
                  {r.recordedByName && ` · by ${r.recordedByName}`}
                </p>
              </div>
              <p className="font-bold whitespace-nowrap">{rs(r.amount)}</p>
            </div>
          ))}
        </div>

        {data && data.meta.totalPages > 1 && (
          <div className="flex items-center justify-between pt-4">
            <Button variant="outline" size="sm" disabled={page <= 1 || isFetching} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft className="h-4 w-4 mr-1" /> Prev
            </Button>
            <span className="text-xs text-muted-foreground">Page {page} of {data.meta.totalPages}</span>
            <Button variant="outline" size="sm" disabled={page >= data.meta.totalPages || isFetching} onClick={() => setPage((p) => p + 1)}>
              Next <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

const MODE_LABELS: Record<string, string> = {
  CASH: 'Cash',
  BANK_TRANSFER: 'Bank transfer',
  CHEQUE: 'Cheque',
  UNSPECIFIED: 'Other',
};

function ReceivedProof({ data, onOpen }: { data: ProfitLossData; onOpen: (kind: string) => void }) {
  const { receivedBreakdown: rb, handoverReconciliation: h, summary } = data;
  const recordedTotal = rb.recorded.reduce((s, r) => s + r.amount, 0);
  const recordedCount = rb.recorded.reduce((s, r) => s + r.count, 0);
  const sum = rb.onSheets.amount + recordedTotal;
  const matches = Math.abs(sum - summary.amountReceived) < 0.01;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card className="bg-card/40 backdrop-blur-xl border-white/10 rounded-[2rem]">
        <CardHeader>
          <CardTitle className="text-base font-bold">Amount Received — where it came from</CardTitle>
          <p className="text-xs text-muted-foreground">Every customer payment recorded in {monthLabel(data.month)}. Click a row to see each payment.</p>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Source</TableHead>
                <TableHead className="text-right">Payments</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow className="cursor-pointer hover:bg-muted/40" onClick={() => onOpen('SHEET')}>
                <TableCell>Collected on delivery sheets</TableCell>
                <TableCell className="text-right">{rb.onSheets.count}</TableCell>
                <TableCell className="text-right">{rs(rb.onSheets.amount)}</TableCell>
              </TableRow>
              {rb.recorded.map((r) => (
                <TableRow key={r.mode} className="cursor-pointer hover:bg-muted/40" onClick={() => onOpen(r.mode)}>
                  <TableCell>Recorded payment — {MODE_LABELS[r.mode] ?? r.mode}</TableCell>
                  <TableCell className="text-right">{r.count}</TableCell>
                  <TableCell className="text-right">{rs(r.amount)}</TableCell>
                </TableRow>
              ))}
              <TableRow className="font-black border-t-2 cursor-pointer hover:bg-muted/40" onClick={() => onOpen('ALL')}>
                <TableCell>Total Amount Received</TableCell>
                <TableCell className="text-right">{rb.onSheets.count + recordedCount}</TableCell>
                <TableCell className="text-right">{rs(summary.amountReceived)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
          {!matches && (
            <p className="mt-2 text-xs text-destructive">Breakdown ({rs(sum)}) does not add up to the total — please report this.</p>
          )}
        </CardContent>
      </Card>

      <Card className="bg-card/40 backdrop-blur-xl border-white/10 rounded-[2rem]">
        <CardHeader>
          <CardTitle className="text-base font-bold">Delivery cash → Driver hand-in</CardTitle>
          <p className="text-xs text-muted-foreground">
            Why the dashboard&apos;s &quot;Cash Collected&quot; is lower: drivers hand in cash after van expenses and crew cash. {h.sheetCount} sheets.
          </p>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex justify-between gap-3"><span>Cash recorded on deliveries</span><span className="font-bold">{rs(h.deliveryCashRecorded)}</span></div>
          <div className="flex justify-between gap-3 text-muted-foreground"><span>− Paid from the van (sheet expenses)</span><span>{rs(h.vanCashExpenses)}</span></div>
          <div className="flex justify-between gap-3 text-muted-foreground"><span>− Crew cash given</span><span>{rs(h.crewCashPaid)}</span></div>
          <div className="flex justify-between gap-3 border-t pt-2"><span>Expected hand-in</span><span className="font-bold">{rs(h.expectedHandIn)}</span></div>
          <div className="flex justify-between gap-3"><span>Actually handed in (at sheet close)</span><span className="font-bold">{rs(h.actualHandedIn)}</span></div>
          <div className="flex justify-between gap-3 border-t pt-2">
            <span>Difference (shortfall / changes after close)</span>
            <span className={cn('font-black', h.difference > 0 ? 'text-destructive' : '')}>{rs(h.difference)}</span>
          </div>
          <p className="text-xs text-muted-foreground pt-2">
            Dashboard Cash Collected = hand-in + recorded payments, recalculated for sheets edited after close. Amount Received here is the
            gross of what customers paid, so it is not reduced by van expenses or shortfalls (those are counted in Expenses).
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function PaymentsSheet({ month, kind, onClose }: { month: string; kind: string | null; onClose: () => void }) {
  const [page, setPage] = useState(1);
  const { data, isLoading, isFetching } = useProfitLossPayments(month, kind, page);
  const title =
    kind === 'SHEET' ? 'Collected on delivery sheets' : kind === 'ALL' ? 'All payments' : `Recorded payments — ${MODE_LABELS[kind ?? ''] ?? kind}`;

  return (
    <Sheet open={!!kind} onOpenChange={(o) => { if (!o) { setPage(1); onClose(); } }}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto bg-background/95 backdrop-blur-xl">
        <SheetHeader className="pb-4 border-b">
          <SheetTitle>{title} — {monthLabel(month)}</SheetTitle>
          {data && (
            <p className="text-sm text-muted-foreground">
              {data.meta.total} payments · Total <span className="font-bold text-foreground">{rs(data.total)}</span>
            </p>
          )}
        </SheetHeader>
        <div className="pt-4 space-y-2">
          {isLoading && Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}
          {data?.rows.length === 0 && <p className="text-center text-muted-foreground py-8">No payments</p>}
          {data?.rows.map((r) => (
            <div key={r.id} className="rounded-xl border border-border p-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate">
                  {r.customerName ?? 'Unknown customer'}
                  {r.customerCode && <span className="ml-2 text-xs font-normal text-muted-foreground">{r.customerCode}</span>}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {new Date(r.date).toLocaleDateString('en-GB', { timeZone: 'Asia/Karachi' })}
                  {' · '}{MODE_LABELS[r.mode] ?? r.mode}
                  {r.description && ` · ${r.description}`}
                </p>
              </div>
              <p className="font-bold whitespace-nowrap">{rs(r.amount)}</p>
            </div>
          ))}
        </div>
        {data && data.meta.totalPages > 1 && (
          <div className="flex items-center justify-between pt-4">
            <Button variant="outline" size="sm" disabled={page <= 1 || isFetching} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft className="h-4 w-4 mr-1" /> Prev
            </Button>
            <span className="text-xs text-muted-foreground">Page {page} of {data.meta.totalPages}</span>
            <Button variant="outline" size="sm" disabled={page >= data.meta.totalPages || isFetching} onClick={() => setPage((p) => p + 1)}>
              Next <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

export function ProfitLossTab() {
  const thisMonth = currentMonth();
  // Month lives in the URL so a refresh / shared link lands on the same month.
  const [monthParam, setMonthParam] = useQueryState('plMonth', parseAsString.withDefault(''));
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(monthParam) && monthParam <= thisMonth ? monthParam : thisMonth;
  const setMonth = (next: string | ((m: string) => string)) => {
    const value = typeof next === 'function' ? next(month) : next;
    setMonthParam(value === thisMonth ? null : value);
  };
  const view = usePlView();
  // Every adjustment is on unless the owner unticked it; the server ignores keys with nothing to adjust.
  const adjustKeys = useMemo(
    () => (view.basis === 'ACTUAL' ? PROFIT_LOSS_ADJUSTMENT_KEYS.filter((k) => !view.off.includes(k)) : []),
    [view.basis, view.off],
  );
  const [detailCategory, setDetailCategory] = useState<string | null>(null);
  const [paymentsKind, setPaymentsKind] = useState<string | null>(null);
  const [addExpenseOpen, setAddExpenseOpen] = useState(false);
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useProfitLoss(month, view.basis, adjustKeys, view.hydrated);

  // The wizard's mutations don't touch the analytics cache, so refresh the P&L when it closes
  // (a no-op refetch if nothing was recorded).
  const handleAddExpenseOpenChange = (open: boolean) => {
    setAddExpenseOpen(open);
    if (!open) queryClient.invalidateQueries({ queryKey: ['analytics', 'profit-loss'] });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="icon" onClick={() => setMonth((m) => shift(m, -1))} aria-label="Previous month">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 sm:flex-none sm:min-w-44 text-center font-bold">{monthLabel(month)}</div>
        <Button variant="outline" size="icon" disabled={month >= thisMonth} onClick={() => setMonth((m) => shift(m, 1))} aria-label="Next month">
          <ChevronRight className="h-4 w-4" />
        </Button>
        {month !== thisMonth && (
          <Button variant="ghost" size="sm" onClick={() => setMonth(thisMonth)}>This month</Button>
        )}
        <div className="w-full sm:w-auto sm:ml-auto flex flex-col-reverse sm:flex-row sm:items-center gap-2 sm:gap-4">
          <div className="inline-flex rounded-full border border-border p-0.5 text-xs font-bold" role="group" aria-label="Cost view">
            {(['CASH', 'ACTUAL'] as const).map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => view.setBasis(b)}
                aria-pressed={view.basis === b}
                className={cn(
                  'rounded-full px-3 py-1.5 transition-colors',
                  view.basis === b ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {b === 'CASH' ? 'Cash paid' : 'Actual cost'}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Company-wide · all vans · {view.basis === 'ACTUAL' ? 'costs moved to the month they belong to' : 'expenses on cash basis'}
          </p>
          <Button onClick={() => setAddExpenseOpen(true)} className="rounded-full font-bold gap-2">
            <Plus className="h-4 w-4" />
            Add Expense
          </Button>
        </div>
      </div>

      {isLoading && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-[2rem]" />)}
          </div>
          <Skeleton className="h-96 rounded-[2rem]" />
        </div>
      )}

      {isError && <p className="text-destructive text-sm">Could not load Profit &amp; Loss. Please try again.</p>}

      {data && (
        <>
          {!data.reconciliation.ok && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              <AlertTriangle className="h-4 w-4 mt-0.5 text-amber-500" />
              <span>
                Expense totals do not reconcile: the Expense table holds {rs(data.reconciliation.expenseTableTotal)} but only{' '}
                {rs(data.reconciliation.groupedExpenseTableTotal)} was grouped (difference {rs(data.reconciliation.difference)}). Please report this.
              </span>
            </div>
          )}

          {view.basis === 'CASH' && <CashViewHint data={data} />}

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Stat
              label="Bottles Sold (net)"
              value={data.summary.bottlesSold.toLocaleString('en')}
              hint={`${data.summary.bottlesDelivered.toLocaleString('en')} delivered − ${data.summary.filledReturned.toLocaleString('en')} filled taken back`}
            />
            <Stat label="Sale" value={rs(data.summary.saleAmount)} />
            <Stat label="Amount Received" value={rs(data.summary.amountReceived)} hint={`${rs(data.summary.receivedOnSheets)} on delivery sheets + ${rs(data.summary.receivedRecorded)} recorded payments`} />
            <Stat
              label={data.basis === 'ACTUAL' ? 'Total Expenses (actual)' : 'Total Expenses'}
              value={rs(data.summary.totalExpenses)}
              hint={data.basis === 'ACTUAL' ? 'Cash paid ' + rs(data.summary.totalExpenses - data.adjustmentTotal) + ' · adjusted' : undefined}
            />
          </div>

          <ReceivedProof data={data} onOpen={setPaymentsKind} />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="bg-card/40 backdrop-blur-xl border-white/10 rounded-[2rem]">
              <CardHeader><CardTitle className="text-base font-bold">Per-Bottle Averages</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between gap-3"><span className="text-muted-foreground">Avg Rs / Bottle</span><span className="font-bold">{rs2(data.summary.avgRatePerBottle)}</span></div>
                <div className="flex justify-between gap-3"><span className="text-muted-foreground">Avg Expense / Bottle</span><span className="font-bold">{rs2(data.summary.avgExpensePerBottle)}</span></div>
                <div className="flex justify-between border-t pt-3">
                  <span className="text-muted-foreground">Avg Profit / Bottle</span>
                  <span className={cn('font-black', data.summary.avgProfitPerBottle != null && profitTone(data.summary.avgProfitPerBottle))}>{rs2(data.summary.avgProfitPerBottle)}</span>
                </div>
              </CardContent>
            </Card>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <ProfitCard label="Sale Profit" sub="Sale − Expenses" value={data.summary.saleProfit} />
              <ProfitCard label="Recovery Profit" sub="Amount Received − Expenses" value={data.summary.recoveryProfit} />
            </div>
          </div>

          <ExpenseTable
            domains={data.domains}
            summary={data.summary}
            onOpen={setDetailCategory}
            actual={view.basis === 'ACTUAL' ? { data, off: view.off, onToggle: view.toggleKey, onReset: view.reset } : undefined}
          />

          <Card className="bg-card/40 backdrop-blur-xl border-white/10 rounded-[2rem]">
            <CardHeader><CardTitle className="text-base font-bold">Month-wise Comparison <span className="text-xs font-normal text-muted-foreground">(cash basis)</span></CardTitle></CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Month</TableHead>
                    <TableHead className="text-right">Bottles</TableHead>
                    <TableHead className="text-right">Sale</TableHead>
                    <TableHead className="text-right">Received</TableHead>
                    <TableHead className="text-right">Expenses</TableHead>
                    <TableHead className="text-right">Exp / Bottle</TableHead>
                    <TableHead className="text-right">Sale Profit</TableHead>
                    <TableHead className="text-right">Recovery Profit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...data.trend].reverse().map((t) => (
                    <TableRow
                      key={t.month}
                      className={cn('cursor-pointer hover:bg-muted/40', t.month === data.month && 'bg-primary/5 font-semibold')}
                      onClick={() => setMonth(t.month)}
                    >
                      <TableCell>{monthLabel(t.month, true)}</TableCell>
                      <TableCell className="text-right">{t.bottlesSold.toLocaleString('en')}</TableCell>
                      <TableCell className="text-right">{rs(t.saleAmount)}</TableCell>
                      <TableCell className="text-right">{rs(t.amountReceived)}</TableCell>
                      <TableCell className="text-right">{rs(t.totalExpenses)}</TableCell>
                      <TableCell className="text-right">{rs2(t.avgExpensePerBottle)}</TableCell>
                      <TableCell className={cn('text-right', profitTone(t.saleProfit))}>{rs(t.saleProfit)}</TableCell>
                      <TableCell className={cn('text-right', profitTone(t.recoveryProfit))}>{rs(t.recoveryProfit)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}

      <AddExpenseWizard open={addExpenseOpen} onOpenChange={handleAddExpenseOpenChange} />
      <PaymentsSheet key={`${month}:pay:${paymentsKind ?? ''}`} month={month} kind={paymentsKind} onClose={() => setPaymentsKind(null)} />
      <DetailsSheet key={`${month}:${detailCategory ?? ''}`} month={month} category={detailCategory} onClose={() => setDetailCategory(null)} />
    </div>
  );
}
