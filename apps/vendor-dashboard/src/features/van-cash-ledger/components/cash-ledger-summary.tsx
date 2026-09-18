'use client';

import { useId, useState, type ReactNode } from 'react';
import { AlertCircle, AlertTriangle, ChevronDown, Lock, RefreshCw } from 'lucide-react';
import { Area, AreaChart, ResponsiveContainer, YAxis } from 'recharts';
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
  Button, Card, CardContent, Skeleton, cn,
} from '@water-supply-crm/ui';
import { useCashLedgerSummary } from '../hooks/use-van-cash-ledger';
import { CASH_LEDGER_BUCKET_META } from '../constants';
import { money, signedMoney } from '../format';
import type { CashLedgerBucket, CashLedgerSummary as CashLedgerSummaryData } from '../api/van-cash-ledger.api';

// ── helpers ────────────────────────────────────────────────────────────────

/** Sign-explicit hero figure: `−₨ 5,000` for a negative, plain `₨ 5,000` otherwise. */
const heroMoney = (n: number) => `${n < 0 ? '−' : ''}${money(n)}`;

/** Screen-reader wording: "820,000 rupees" / "negative 5,000 rupees". */
const rupees = (n: number) =>
  `${n < 0 ? 'negative ' : ''}${Math.abs(n).toLocaleString('en-PK', { maximumFractionDigits: 2 })} rupees`;

const MICRO_LABEL = 'text-[10px] font-black uppercase tracking-widest text-muted-foreground';

type Sign = '+' | '−' | '=';
const SIGN_WORD: Record<Sign, string> = { '+': 'plus', '−': 'minus', '=': 'equals' };

interface SubLine {
  key: string;
  label: string;
  value: number;
  bucket: CashLedgerBucket;
}

interface Term {
  key: string;
  label: string;
  value: number;
  sign?: Sign;
  bucket?: CashLedgerBucket;
  /** '=' result terms (Available cash, Expected closing). */
  emphasis?: boolean;
  /** Overrides the bucket tone (result terms turn destructive when negative). */
  tone?: string;
  subLines?: SubLine[];
  /** Renders the "sheet cash detail" toggle under this term. */
  hasSheetDetail?: boolean;
}

function buildTerms(data: CashLedgerSummaryData): Term[] {
  const s = data.statement;
  const isVan = data.scope === 'VAN';
  const availableCash = s.broughtForward + s.totalCashIn;

  const subLines: SubLine[] = [{ key: 'office', label: 'Office', value: s.officeExpenses, bucket: 'OFFICE_EXPENSE' }];
  // Payroll only when there is some; crew cash is its OWN sub-category (spec Decision 2) — in van
  // scope both are office-wide tiers, so they only appear if the server sent a non-zero figure.
  if (s.payrollCash > 0) subLines.push({ key: 'payroll', label: 'Payroll', value: s.payrollCash, bucket: 'PAYROLL_CASH' });
  if (!isVan || s.crewCash !== 0) subLines.push({ key: 'crew', label: 'Crew Cash', value: s.crewCash, bucket: 'CREW_CASH' });

  const terms: Term[] = [
    { key: 'bf', label: 'Brought forward', value: s.broughtForward },
    {
      key: 'sheet', label: CASH_LEDGER_BUCKET_META.SHEET_CASH_IN.label, value: s.sheetCashIn,
      sign: '+', bucket: 'SHEET_CASH_IN', hasSheetDetail: data.memo?.sheetBreakdown?.sheets > 0,
    },
    { key: 'office-in', label: CASH_LEDGER_BUCKET_META.OFFICE_CASH_IN.label, value: s.officeCashIn, sign: '+', bucket: 'OFFICE_CASH_IN' },
    {
      key: 'available', label: 'Available cash', value: availableCash, sign: '=', emphasis: true,
      tone: availableCash < 0 ? 'text-destructive' : 'text-foreground',
    },
    { key: 'expenses', label: 'Total Expenses', value: s.totalExpenses, sign: '−', bucket: 'OFFICE_EXPENSE', subLines },
  ];
  if (!isVan || s.ownerTransfer !== 0) {
    terms.push({ key: 'owner', label: CASH_LEDGER_BUCKET_META.OWNER_TRANSFER.label, value: s.ownerTransfer, sign: '−', bucket: 'OWNER_TRANSFER' });
  }
  if (!isVan || s.fuelCard !== 0) {
    terms.push({ key: 'fuel', label: CASH_LEDGER_BUCKET_META.FUEL_CARD.label, value: s.fuelCard, sign: '−', bucket: 'FUEL_CARD' });
  }
  terms.push({
    key: 'closing', label: 'Expected closing', value: s.expectedClosing, sign: '=', emphasis: true,
    tone: s.expectedClosing < 0 ? 'text-destructive' : 'text-foreground',
  });
  return terms;
}

// ── sparkline ──────────────────────────────────────────────────────────────

function TrendSparkline({ trend }: { trend: CashLedgerSummaryData['trend'] | undefined }) {
  const points = (trend ?? [])
    .map((t) => ({ date: t.date, closing: Number(t.closing) }))
    .filter((t) => Number.isFinite(t.closing));
  if (points.length < 2) return null;

  const negative = points[points.length - 1].closing < 0;
  return (
    <div
      role="img"
      aria-label="Trend of expected closing cash across the selected range"
      className={cn('h-10 w-full sm:w-56 lg:w-72 shrink-0', negative ? 'text-destructive' : 'text-emerald-500')}
    >
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <AreaChart data={points} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
          <YAxis hide domain={['dataMin', 'dataMax']} />
          <Area
            type="monotone"
            dataKey="closing"
            stroke="currentColor"
            strokeWidth={1.5}
            fill="currentColor"
            fillOpacity={0.12}
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── equation ───────────────────────────────────────────────────────────────

function TermValue({ term }: { term: Term }) {
  const meta = term.bucket ? CASH_LEDGER_BUCKET_META[term.bucket] : null;
  // Total Expenses is a sum of several cost buckets — keep it in the destructive (cost) tone.
  const isNegativeNeutral = !term.bucket && !term.tone && term.value < 0;
  const tone = isNegativeNeutral ? 'text-destructive' : term.tone ?? meta?.text ?? 'text-foreground';
  // Result terms and Brought forward can legitimately be negative — show the sign; bucket terms are magnitudes.
  const valueText = term.emphasis || !term.bucket ? heroMoney(term.value) : money(term.value);

  return (
    <p
      className={cn(
        'font-mono font-black tabular-nums text-base sm:text-lg leading-tight break-words',
        tone,
        // Transfers are not costs — outlined treatment instead of a plain coloured figure.
        meta?.isTransfer && 'inline-block rounded-lg border px-2 py-0.5',
        meta?.isTransfer && meta.chip,
      )}
    >
      {valueText}
    </p>
  );
}

function SubLines({ lines }: { lines: SubLine[] }) {
  return (
    <ul className="mt-1.5 space-y-0.5">
      {lines.map((l) => {
        const meta = CASH_LEDGER_BUCKET_META[l.bucket];
        return (
          <li key={l.key} className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
            <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', meta.dot)} aria-hidden />
            <span className="truncate">{l.label}</span>
            <span className={cn('ml-auto pl-2 font-mono font-bold tabular-nums', meta.text)}>{money(l.value)}</span>
          </li>
        );
      })}
    </ul>
  );
}

function SheetDetailToggle({ open, onToggle, panelId }: { open: boolean; onToggle: () => void; panelId: string }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={panelId}
      className="mt-1 inline-flex items-center gap-1 py-2 sm:py-0.5 text-[11px] font-semibold text-muted-foreground hover:text-foreground transition-colors"
    >
      Sheet cash detail
      <ChevronDown className={cn('h-3 w-3', open && 'rotate-180')} aria-hidden />
    </button>
  );
}

function SheetDetailLine({ data, id }: { data: CashLedgerSummaryData; id: string }) {
  const b = data.memo.sheetBreakdown;
  return (
    <p id={id} className="text-[11px] leading-relaxed text-muted-foreground font-medium break-words">
      {b.sheets} {b.sheets === 1 ? 'sheet' : 'sheets'} · Collected{' '}
      <span className="font-mono font-bold tabular-nums text-foreground/80">{money(b.collected)}</span> − Expenses{' '}
      <span className="font-mono font-bold tabular-nums text-foreground/80">{money(b.expenses)}</span> − Crew Cash{' '}
      <span className="font-mono font-bold tabular-nums text-foreground/80">{money(b.crewCash)}</span> ={' '}
      <span className="font-mono font-bold tabular-nums text-emerald-500">{money(b.net)}</span>
      {b.other !== 0 && (
        <>
          {' '}
          <span className="font-mono font-bold tabular-nums text-amber-500">{signedMoney(b.other)}</span> corrections
        </>
      )}
    </p>
  );
}

function Glyph({ sign, className }: { sign: Sign; className?: string }) {
  return (
    <>
      <span aria-hidden className={cn('font-black text-muted-foreground select-none leading-none', className)}>
        {sign}
      </span>
      <span className="sr-only">{SIGN_WORD[sign]}</span>
    </>
  );
}

function EquationList({ data, layout }: { data: CashLedgerSummaryData; layout: 'row' | 'stack' }) {
  const [detailOpen, setDetailOpen] = useState(false);
  const detailId = useId();
  const terms = buildTerms(data);
  const isRow = layout === 'row';

  return (
    <div className="space-y-3">
      <ol
        aria-label="How expected closing cash adds up"
        className={isRow ? 'flex flex-wrap items-start gap-x-3 gap-y-4' : 'space-y-3'}
      >
        {terms.map((term) => (
          <li key={term.key} className={cn('flex items-start gap-2', !isRow && 'gap-3')}>
            {term.sign ? (
              <span className={cn('shrink-0 text-center', isRow ? 'mt-[15px] w-3' : 'mt-0.5 w-5')}>
                <Glyph sign={term.sign} className={isRow ? 'text-base' : 'text-lg'} />
              </span>
            ) : (
              !isRow && <span className="w-5 shrink-0" aria-hidden />
            )}
            <div
              className={cn(
                'min-w-0',
                term.emphasis && 'rounded-xl border border-border/60 bg-muted/40 px-2.5 py-1.5',
                !isRow && 'flex-1',
              )}
            >
              <p className={cn(MICRO_LABEL, 'truncate')}>{term.label}</p>
              <TermValue term={term} />
              {term.subLines && <SubLines lines={term.subLines} />}
              {term.hasSheetDetail && (
                <SheetDetailToggle open={detailOpen} onToggle={() => setDetailOpen((o) => !o)} panelId={detailId} />
              )}
              {!isRow && term.hasSheetDetail && detailOpen && (
                <div className="pb-1"><SheetDetailLine data={data} id={detailId} /></div>
              )}
            </div>
          </li>
        ))}
      </ol>
      {isRow && detailOpen && terms.some((t) => t.hasSheetDetail) && (
        <div className="rounded-xl bg-muted/30 px-3 py-2"><SheetDetailLine data={data} id={detailId} /></div>
      )}
    </div>
  );
}

function MemoLines({ data }: { data: CashLedgerSummaryData }) {
  const { memo } = data;
  const lines: ReactNode[] = [];

  const ph = memo.pendingHandovers;
  if (ph && (ph.amount !== 0 || ph.count > 0)) {
    lines.push(
      <>
        {money(ph.amount)} pending in transit ({ph.count} {ph.count === 1 ? 'handover' : 'handovers'})
      </>,
    );
  }
  if (memo.sheetBreakdown && memo.sheetBreakdown.crewCash !== 0) {
    lines.push(<>Crew cash paid on sheets {money(memo.sheetBreakdown.crewCash)} — already inside Sheet Cash In</>);
  }
  if (memo.approvalAdjustments !== 0) {
    lines.push(<>Approval adjustments {signedMoney(memo.approvalAdjustments)} vs sheet figures</>);
  }
  if (lines.length === 0) return null;

  return (
    <ul className="space-y-0.5 pt-1" aria-label="Notes on this statement">
      {lines.map((line, i) => (
        <li key={i} className="text-[11px] leading-relaxed font-medium text-muted-foreground break-words">
          {line}
        </li>
      ))}
    </ul>
  );
}

// ── states ─────────────────────────────────────────────────────────────────

function SummarySkeleton() {
  return (
    <Card className="rounded-3xl border-border/50 bg-card/40" aria-busy="true" aria-label="Loading cash summary">
      <CardContent className="p-4 sm:p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div className="space-y-2">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-8 sm:h-10 w-56" />
            <Skeleton className="h-3 w-32" />
          </div>
          <Skeleton className="h-10 w-full sm:w-56 lg:w-72" />
        </div>
        <div className="hidden md:flex flex-wrap gap-x-6 gap-y-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <Skeleton className="h-2.5 w-20" />
              <Skeleton className="h-5 w-24" />
            </div>
          ))}
        </div>
        <Skeleton className="h-11 rounded-2xl md:hidden" />
      </CardContent>
    </Card>
  );
}

function NoAccessPanel() {
  return (
    <Card className="rounded-3xl border-border/50 bg-card/30">
      <CardContent className="p-6 sm:p-8 flex flex-col items-center text-center gap-2">
        <Lock className="h-6 w-6 text-muted-foreground/60" aria-hidden />
        <h2 className="text-base font-bold">You don&apos;t have access to the cash ledger</h2>
        <p className="text-xs sm:text-sm text-muted-foreground max-w-md">
          Ask an administrator to grant you the cash ledger permission if you need to see office cash.
        </p>
      </CardContent>
    </Card>
  );
}

function SummaryErrorCard({ message, onRetry, retrying }: { message: string; onRetry: () => void; retrying: boolean }) {
  return (
    <Card role="alert" className="rounded-3xl border-destructive/30 bg-destructive/5">
      <CardContent className="p-4 sm:p-6 flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" aria-hidden />
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-destructive">Couldn&apos;t load the cash summary</h2>
            <p className="text-xs text-muted-foreground break-words">{message}</p>
          </div>
        </div>
        <Button
          variant="outline"
          onClick={onRetry}
          disabled={retrying}
          className="h-11 sm:h-9 rounded-full px-5 text-xs font-bold w-full sm:w-auto gap-2"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', retrying && 'animate-spin')} aria-hidden />
          Retry
        </Button>
      </CardContent>
    </Card>
  );
}

const errorStatus = (error: unknown): number | undefined =>
  (error as { response?: { status?: number } } | null)?.response?.status;

const errorMessage = (error: unknown): string => {
  const raw = (error as { response?: { data?: { message?: unknown } } } | null)?.response?.data?.message;
  if (Array.isArray(raw)) return raw.join(', ');
  if (typeof raw === 'string' && raw) return raw;
  return (error as Error | null)?.message || 'Something went wrong while loading the summary.';
};

// ── main ───────────────────────────────────────────────────────────────────

/**
 * The Cash Ledger "range statement" hero card (spec §4.4): expected closing
 * cash, live available balance, a trend sparkline and the full equation that
 * produces the number. Fails independently of the timeline.
 */
export function CashLedgerSummary() {
  const { data, isLoading, isError, error, refetch, isFetching } = useCashLedgerSummary();

  if (isLoading) return <SummarySkeleton />;

  if (!data) {
    if (isError) {
      return errorStatus(error) === 403
        ? <NoAccessPanel />
        : <SummaryErrorCard message={errorMessage(error)} onRetry={() => void refetch()} retrying={isFetching} />;
    }
    return <SummarySkeleton />;
  }

  const { statement, availableBalance, trend } = data;
  const closing = statement.expectedClosing;
  const negative = closing < 0;
  // Previous data stays visible (dimmed) while a new range / van is loading.
  const dimmed = isFetching;

  return (
    <Card
      className={cn('rounded-3xl border-border/50 bg-card/40', dimmed && 'opacity-60')}
      aria-busy={dimmed}
    >
      <CardContent className="p-4 sm:p-6 space-y-5">
        <section className="flex flex-col sm:flex-row sm:items-end justify-between gap-4" aria-labelledby="cl-hero-label">
          <div className="min-w-0">
            <h2 id="cl-hero-label" className={MICRO_LABEL}>Expected closing cash</h2>
            <p
              className={cn(
                'mt-1 flex items-center gap-2 font-mono font-black tabular-nums leading-tight',
                'text-[28px] sm:text-4xl break-words',
                negative ? 'text-destructive' : 'text-foreground',
              )}
            >
              {negative && <AlertTriangle className="h-6 w-6 sm:h-7 sm:w-7 shrink-0" aria-hidden />}
              <span aria-hidden>{heroMoney(closing)}</span>
              <span className="sr-only">Expected closing cash: {rupees(closing)}</span>
            </p>
            {negative && (
              <p className="mt-1 text-[11px] font-bold uppercase tracking-wider text-destructive">Negative</p>
            )}
            <p className="mt-2 text-xs font-medium text-muted-foreground">
              Available now{' '}
              <span
                className={cn(
                  'font-mono font-bold tabular-nums',
                  availableBalance < 0 ? 'text-destructive' : 'text-foreground',
                )}
              >
                {heroMoney(availableBalance)}
              </span>
              <span className="sr-only"> ({rupees(availableBalance)})</span>
            </p>
          </div>
          <TrendSparkline trend={trend} />
        </section>

        {/* ≥ md: the equation laid out as steps (wraps below lg). */}
        <div className="hidden md:block space-y-2">
          <EquationList data={data} layout="row" />
          <MemoLines data={data} />
        </div>

        {/* < md: collapsed accordion with a vertical list. */}
        <div className="md:hidden">
          <Accordion type="single" collapsible>
            <AccordionItem value="equation" className="rounded-2xl border border-border/50 bg-background/30 px-3">
              <AccordionTrigger className="py-3 min-h-11 text-xs font-bold">How this adds up</AccordionTrigger>
              <AccordionContent className="space-y-2">
                <EquationList data={data} layout="stack" />
                <MemoLines data={data} />
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>

        {isError && (
          <p role="status" className="flex flex-wrap items-center gap-2 text-[11px] font-medium text-amber-500">
            <AlertCircle className="h-3.5 w-3.5" aria-hidden />
            Couldn&apos;t refresh — showing the last loaded figures.
            <button
              type="button"
              onClick={() => void refetch()}
              className="font-bold underline underline-offset-2 py-2 sm:py-0"
            >
              Retry
            </button>
          </p>
        )}
      </CardContent>
    </Card>
  );
}
