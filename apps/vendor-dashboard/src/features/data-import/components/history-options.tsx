'use client';

import { AlertTriangle } from 'lucide-react';
import {
  Card, CardContent, CardHeader, CardTitle, Input, Label, cn,
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@water-supply-crm/ui';
import type { HistoryOptions, ReportingMode } from '../api/data-import.api';

export interface HistoryOptionsState {
  cutoverDate: string;
  reportingMode: ReportingMode;
  reportsAcknowledged: boolean;
  dateOrder: HistoryOptions['dateOrder'];
}

export const todayIso = () => new Date().toISOString().slice(0, 10);
const firstOfMonth = () => `${todayIso().slice(0, 7)}-01`;

/** Client-side mirror of the server rules, so the user sees the problem before pressing Preview. */
export function historyProblems(s: HistoryOptionsState): string[] {
  const out: string[] = [];
  if (!s.cutoverDate) out.push('Enter the cutover date — the last day your file covers.');
  else if (s.cutoverDate > todayIso()) out.push('The cutover date cannot be in the future.');
  if (s.reportingMode === 'COUNT_IN_REPORTS') {
    if (s.cutoverDate && s.cutoverDate >= firstOfMonth()) out.push('To count history in reports, the cutover date must be before the first day of this month.');
    if (!s.reportsAcknowledged) out.push('Tick the confirmation about reports.');
  }
  return out;
}

const MODES: { value: ReportingMode; title: string; hint: string; badge?: string }[] = [
  {
    value: 'STATEMENT_ONLY',
    title: 'For customer statements only',
    hint: 'History appears on each customer’s statement and ledger. Sales, P&L, dashboard and analytics are NOT affected.',
    badge: 'Recommended',
  },
  {
    value: 'COUNT_IN_REPORTS',
    title: 'Count in reports as well',
    hint: 'History is stored as normal deliveries and payments, so past months show up in revenue / received figures.',
  },
];

interface Props {
  state: HistoryOptionsState;
  onChange: (patch: Partial<HistoryOptionsState>) => void;
  needsProduct: boolean;
  productId: string;
  onProduct: (id: string) => void;
  activeProducts: { id: string; name: string; basePrice: number }[];
  saveName: string;
  onSaveName: (v: string) => void;
}

/** Options panel for TRANSACTION_HISTORY (step 2). */
export function HistoryOptionsCard({ state, onChange, needsProduct, productId, onProduct, activeProducts, saveName, onSaveName }: Props) {
  return (
    <Card className="rounded-3xl">
      <CardHeader><CardTitle className="text-lg">Import options</CardTitle></CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-1.5 max-w-xs">
          <Label htmlFor="cutover">Cutover date — your file covers up to and including</Label>
          <Input id="cutover" type="date" max={todayIso()} className="h-10 rounded-xl" value={state.cutoverDate} onChange={(e) => onChange({ cutoverDate: e.target.value })} />
          <p className="text-xs text-muted-foreground">
            Customers must already exist with the balance they had on this date. Rows dated after it are not imported — real deliveries and payments recorded in the system own that period.
          </p>
        </div>

        <div className="space-y-2">
          <Label>Where should this history be used?</Label>
          <div className="grid gap-2 sm:grid-cols-2">
            {MODES.map((m) => (
              <button
                key={m.value} type="button" data-testid={`mode-${m.value}`} onClick={() => onChange({ reportingMode: m.value })}
                className={cn('rounded-xl border p-3 text-left transition-colors', state.reportingMode === m.value ? 'border-primary bg-primary/5' : 'hover:border-primary/40')}
              >
                <p className="font-semibold text-sm">{m.title}{m.badge && <span className="ml-2 text-[10px] font-bold uppercase text-emerald-600">{m.badge}</span>}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{m.hint}</p>
              </button>
            ))}
          </div>
          {state.reportingMode === 'COUNT_IN_REPORTS' && (
            <label className="flex items-start gap-2 rounded-xl bg-amber-500/10 p-3 text-sm">
              <input type="checkbox" className="h-4 w-4 mt-0.5" data-testid="reports-ack" checked={state.reportsAcknowledged} onChange={(e) => onChange({ reportsAcknowledged: e.target.checked })} />
              <span>
                <AlertTriangle className="inline h-4 w-4 mr-1 text-amber-600" />
                I understand: old months’ received amounts and customer sales will appear in reports, but those months have <strong>no expenses or cost of goods</strong>, so profit for them will look inflated. The Profit &amp; Loss “Sale” line (which needs a daily sheet) will not include them.
              </span>
            </label>
          )}
        </div>

        {needsProduct && (
          <div className="space-y-1.5 max-w-xs">
            <Label>Product for the bottle movement</Label>
            <Select value={productId} onValueChange={onProduct}>
              <SelectTrigger className="h-10 rounded-xl"><SelectValue placeholder="Choose a product" /></SelectTrigger>
              <SelectContent>{activeProducts.map((p) => <SelectItem key={p.id} value={p.id}>{p.name} — ₨ {p.basePrice}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        )}

        <div className="space-y-1.5 max-w-xs">
          <Label>Dates in a “1/5/2025” format are</Label>
          <Select value={state.dateOrder} onValueChange={(v) => onChange({ dateOrder: v as HistoryOptions['dateOrder'] })}>
            <SelectTrigger className="h-10 rounded-xl"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="MDY">Month / Day / Year (1/5/2025 = 5 January)</SelectItem>
              <SelectItem value="DMY">Day / Month / Year (1/5/2025 = 1 May)</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">Real Excel dates and 2025-01-05 style dates are always read correctly.</p>
        </div>

        <div className="space-y-1.5 max-w-sm">
          <Label>Save this mapping for next time (optional)</Label>
          <Input className="h-10 rounded-xl" placeholder="e.g. My ledger export" value={saveName} onChange={(e) => onSaveName(e.target.value)} />
        </div>
      </CardContent>
    </Card>
  );
}
