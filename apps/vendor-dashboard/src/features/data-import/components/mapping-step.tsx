'use client';

import { useMemo, useState } from 'react';
import { AlertCircle, ArrowRight, Loader2 } from 'lucide-react';
import {
  Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, cn,
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@water-supply-crm/ui';
import type { ImportFieldDef, ImportOptions, ImportWizardData, MappingConfidence } from '../api/data-import.api';
import { importErrorOf, useColumnValues, useSaveMapping } from '../hooks/use-data-import';
import { HistoryOptionsCard, historyProblems, type HistoryOptionsState } from './history-options';

const NONE = '__none__';
const SKIP_ROW = '__SKIP_ROW__';
const UNSET = '__unset__';

const CONF_LABEL: Record<MappingConfidence, { label: string; variant: 'success' | 'info' | 'warning' | 'secondary' }> = {
  profile: { label: 'Saved mapping', variant: 'success' },
  high: { label: 'Matched', variant: 'success' },
  medium: { label: 'Likely', variant: 'info' },
  low: { label: 'Check', variant: 'warning' },
};

type ColumnsState = Record<string, string>; // header → field key | NONE

/** Value-mapping panel for one enum-like field (payment type, status). */
function ValueMapPanel({
  batchId, field, header, map, onChange,
}: {
  batchId: string;
  field: ImportFieldDef;
  header: string;
  map: Record<string, string>;
  onChange: (fileValueLower: string, target: string) => void;
}) {
  const { data: values, isLoading } = useColumnValues(batchId, header);
  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold">
        {field.label} <span className="text-muted-foreground font-normal">— column “{header}”</span>
      </p>
      {field.help && <p className="text-xs text-muted-foreground">{field.help}</p>}
      {isLoading && <p className="text-xs text-muted-foreground">Reading values…</p>}
      <div className="grid gap-2 sm:grid-cols-2">
        {values?.map((v) => {
          const k = v.value.toLowerCase();
          const current = map[k] ?? field.defaultValueMap?.[k] ?? UNSET;
          return (
            <div key={k} className={cn('flex items-center gap-2 rounded-xl border p-2', current === UNSET && 'border-amber-500/60 bg-amber-500/5')}>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">“{v.value}”</p>
                <p className="text-[11px] text-muted-foreground">{v.count} customer{v.count === 1 ? '' : 's'}</p>
              </div>
              <Select value={current} onValueChange={(t) => onChange(k, t)}>
                <SelectTrigger className="h-9 w-[150px] rounded-lg"><SelectValue placeholder="Choose…" /></SelectTrigger>
                <SelectContent>
                  {current === UNSET && <SelectItem value={UNSET} disabled>Choose…</SelectItem>}
                  {field.enumValues?.map((e) => <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>)}
                  <SelectItem value={SKIP_ROW}>Skip these rows</SelectItem>
                </SelectContent>
              </Select>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface Props {
  batchId: string;
  data: ImportWizardData;
  onPlanned: () => void;
}

/** Step 2 — confirm which column feeds which field, map values, set options, then build the plan. */
export function MappingStep({ batchId, data, onPlanned }: Props) {
  const { fields, headers, suggestions, sampleRows, batch, matchedProfile, activeProducts } = data;
  const save = useSaveMapping(batchId);
  const fieldByKey = useMemo(() => Object.fromEntries(fields.map((f) => [f.key, f])), [fields]);

  // Initial state: a mapping already saved on the batch (back from review) wins, then the suggestions.
  const [columns, setColumns] = useState<ColumnsState>(() => {
    const init: ColumnsState = {};
    for (const h of headers) {
      const saved = batch.mapping?.columns;
      init[h] = saved ? (saved[h] ?? NONE) : (suggestions.find((s) => s.header === h)?.fieldKey ?? NONE);
    }
    return init;
  });
  const [valueMaps, setValueMaps] = useState<Record<string, Record<string, string>>>(
    () => batch.mapping?.valueMaps ?? matchedProfile?.valueMaps ?? {},
  );
  const defaults = batch.options ?? matchedProfile?.optionDefaults ?? {};
  const [productId, setProductId] = useState<string>(batch.options?.productId ?? (activeProducts.length === 1 ? activeProducts[0].id : ''));
  const [balanceSign, setBalanceSign] = useState<ImportOptions['balanceSign'] | ''>(defaults.balanceSign ?? '');
  const [asOf, setAsOf] = useState<string>(batch.options?.balancesAsOf ?? '');
  const [codeStrategy, setCodeStrategy] = useState<ImportOptions['codeStrategy']>(defaults.codeStrategy ?? 'USE_FILE_CODES');
  const [defaultPaymentType, setDefaultPaymentType] = useState<ImportOptions['defaultPaymentType']>(defaults.defaultPaymentType ?? 'CASH');
  const [areaIntoAddress, setAreaIntoAddress] = useState<boolean>(defaults.areaIntoAddress ?? true);
  const [saveName, setSaveName] = useState('');
  const [serverError, setServerError] = useState<string | null>(batch.errorMessage);

  // ── TRANSACTION_HISTORY options ──
  const isHistory = batch.entity === 'TRANSACTION_HISTORY';
  const [hist, setHist] = useState<HistoryOptionsState>(() => ({
    cutoverDate: batch.options?.cutoverDate ?? '',
    reportingMode: batch.options?.reportingMode ?? 'STATEMENT_ONLY',
    reportsAcknowledged: batch.options?.reportsAcknowledged ?? false,
    dateOrder: batch.options?.dateOrder ?? (matchedProfile?.optionDefaults as { dateOrder?: 'MDY' | 'DMY' } | null)?.dateOrder ?? 'MDY',
  }));

  const confidence = (h: string) => suggestions.find((s) => s.header === h)?.confidence ?? null;
  const headerOf = (key: string) => headers.find((h) => columns[h] === key);
  const mapped = (key: string) => !!headerOf(key);

  const setColumn = (header: string, key: string) =>
    setColumns((prev) => {
      const next = { ...prev };
      // A field can only be fed by one column — free it from any other column first.
      if (key !== NONE) for (const h of headers) if (next[h] === key) next[h] = NONE;
      next[header] = key;
      return next;
    });

  // ── what the options panel must ask, derived from what is mapped ──
  const needsProduct = isHistory ? mapped('filled') || mapped('empty') || mapped('bottleBalanceAfter') : mapped('openingBottles') || mapped('rate');
  const needsSign = !isHistory && mapped('openingBalance');
  const needsAsOf = !isHistory && (mapped('openingBalance') || mapped('openingBottles'));
  const enumFields = (['paymentType', 'isActive'] as const).filter((k) => mapped(k));

  const problems: string[] = [];
  if (isHistory) {
    if (!mapped('customerCode')) problems.push('Map the customer code column.');
    if (!mapped('date')) problems.push('Map the date column.');
    if (!(mapped('charge') || mapped('paid') || mapped('filled') || mapped('empty'))) problems.push('Map at least one of: charge, paid, filled bottles, empty bottles.');
    problems.push(...historyProblems(hist));
  } else {
    if (!mapped('name')) problems.push('Map the customer name column.');
    if (!mapped('address') && !mapped('area')) problems.push('Map an address column (or at least an area column).');
  }
  if (needsProduct && activeProducts.length === 0) problems.push('Create an active product first — bottle balances and rates belong to a product.');
  if (needsProduct && activeProducts.length > 1 && !productId) problems.push('Choose the product these bottle balances / rates are for.');
  if (needsSign && !balanceSign) problems.push('Say what a positive balance means.');
  if (needsAsOf && !asOf) problems.push('Enter the date these balances were true on.');

  const submit = async () => {
    setServerError(null);
    const cols: Record<string, string | null> = {};
    for (const h of headers) cols[h] = columns[h] === NONE ? null : columns[h];
    // Send only value maps for fields that are mapped, and only explicit user choices.
    const vm: Record<string, Record<string, string>> = {};
    for (const k of enumFields) if (valueMaps[k]) vm[k] = Object.fromEntries(Object.entries(valueMaps[k]).filter(([, v]) => v !== UNSET));
    try {
      await save.mutateAsync({
        columns: cols,
        valueMaps: vm,
        options: isHistory
          ? {
              cutoverDate: hist.cutoverDate,
              reportingMode: hist.reportingMode,
              reportsAcknowledged: hist.reportingMode === 'COUNT_IN_REPORTS' ? hist.reportsAcknowledged : false,
              dateOrder: hist.dateOrder,
              ...(needsProduct && productId ? { productId } : {}),
            }
          : {
          ...(needsProduct && productId ? { productId } : {}),
          ...(needsSign && balanceSign ? { balanceSign } : {}),
          ...(needsAsOf && asOf ? { balancesAsOf: asOf } : {}),
          codeStrategy: mapped('customerCode') ? codeStrategy : 'GENERATE',
          defaultPaymentType,
          areaIntoAddress,
        },
        saveProfileAs: saveName.trim() || undefined,
      });
      onPlanned();
    } catch (e) {
      setServerError(importErrorOf(e, 'Could not build the preview.').message);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="rounded-3xl">
        <CardHeader>
          <CardTitle className="text-lg">Match your columns</CardTitle>
          <p className="text-sm text-muted-foreground">
            We matched what we could. Check each line and fix anything wrong; set a column to “Ignore” if it isn’t needed.
            {matchedProfile && <> Using your saved mapping <strong>“{matchedProfile.name}”</strong>.</>}
          </p>
        </CardHeader>
        <CardContent className="p-0 sm:p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Your column</TableHead>
                  <TableHead>Examples</TableHead>
                  <TableHead className="w-[260px]">Goes into</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {headers.map((h) => {
                  const conf = confidence(h);
                  const examples = [...new Set(sampleRows.map((r) => r.values[h]).filter((v) => v !== null && v !== ''))].slice(0, 3);
                  return (
                    <TableRow key={h}>
                      <TableCell className="font-medium whitespace-nowrap">{h}</TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[260px] truncate">{examples.map(String).join(' · ') || '—'}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Select value={columns[h]} onValueChange={(v) => setColumn(h, v)}>
                            <SelectTrigger className="h-9 rounded-lg"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NONE}>Ignore this column</SelectItem>
                              {fields.map((f) => (
                                <SelectItem key={f.key} value={f.key}>{f.label}{f.required ? ' *' : ''}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {conf && columns[h] !== NONE && columns[h] === (suggestions.find((s) => s.header === h)?.fieldKey ?? NONE) && (
                            <Badge variant={CONF_LABEL[conf].variant}>{CONF_LABEL[conf].label}</Badge>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {enumFields.length > 0 && (
        <Card className="rounded-3xl">
          <CardHeader><CardTitle className="text-lg">Match the values</CardTitle></CardHeader>
          <CardContent className="space-y-6">
            {enumFields.map((k) => (
              <ValueMapPanel
                key={k}
                batchId={batchId}
                field={fieldByKey[k]}
                header={headerOf(k) as string}
                map={valueMaps[k] ?? {}}
                onChange={(fileValue, target) => setValueMaps((p) => ({ ...p, [k]: { ...(p[k] ?? {}), [fileValue]: target } }))}
              />
            ))}
            <p className="text-xs text-muted-foreground">
              Values we can’t place are never guessed — those rows are flagged as errors in the preview and skipped.
            </p>
          </CardContent>
        </Card>
      )}

      {isHistory && (
        <HistoryOptionsCard
          state={hist}
          onChange={(patch) => setHist((p) => ({ ...p, ...patch }))}
          needsProduct={needsProduct}
          productId={productId}
          onProduct={setProductId}
          activeProducts={activeProducts}
          saveName={saveName}
          onSaveName={setSaveName}
        />
      )}

      {!isHistory && (
      <Card className="rounded-3xl">
        <CardHeader><CardTitle className="text-lg">Import options</CardTitle></CardHeader>
        <CardContent className="space-y-5">
          {needsSign && (
            <div className="space-y-2">
              <Label>In your balance column, a positive number means…</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                {([
                  ['POSITIVE_MEANS_CUSTOMER_OWES', 'The customer owes us', 'Balance 500 → customer has to pay ₨ 500'],
                  ['POSITIVE_MEANS_WE_OWE_CUSTOMER', 'We owe the customer', 'Balance 500 → customer has ₨ 500 credit'],
                ] as const).map(([v, title, hint]) => (
                  <button
                    key={v} type="button" onClick={() => setBalanceSign(v)}
                    className={cn('rounded-xl border p-3 text-left transition-colors', balanceSign === v ? 'border-primary bg-primary/5' : 'hover:border-primary/40')}
                  >
                    <p className="font-semibold text-sm">{title}</p>
                    <p className="text-xs text-muted-foreground">{hint}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {needsAsOf && (
            <div className="space-y-1.5 max-w-xs">
              <Label>These balances are as of</Label>
              <Input type="date" className="h-10 rounded-xl" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
              <p className="text-xs text-muted-foreground">Recorded with the import for your records. No ledger entries are created.</p>
            </div>
          )}

          {needsProduct && (
            <div className="space-y-1.5 max-w-xs">
              <Label>Product for bottle balances &amp; rates</Label>
              <Select value={productId} onValueChange={setProductId}>
                <SelectTrigger className="h-10 rounded-xl"><SelectValue placeholder="Choose a product" /></SelectTrigger>
                <SelectContent>{activeProducts.map((p) => <SelectItem key={p.id} value={p.id}>{p.name} — ₨ {p.basePrice}</SelectItem>)}</SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">A custom rate is stored only for customers whose rate differs from the product price.</p>
            </div>
          )}

          {mapped('customerCode') && (
            <div className="space-y-2">
              <Label>Customer codes</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                {([
                  ['USE_FILE_CODES', 'Use the codes from my file', 'Rows with a blank code get a generated one.'],
                  ['GENERATE', 'Generate new codes (L1, L2…)', 'Ignores the code column.'],
                ] as const).map(([v, title, hint]) => (
                  <button
                    key={v} type="button" onClick={() => setCodeStrategy(v)}
                    className={cn('rounded-xl border p-3 text-left transition-colors', codeStrategy === v ? 'border-primary bg-primary/5' : 'hover:border-primary/40')}
                  >
                    <p className="font-semibold text-sm">{title}</p>
                    <p className="text-xs text-muted-foreground">{hint}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {!mapped('paymentType') && (
            <div className="space-y-1.5 max-w-xs">
              <Label>Payment type for everyone</Label>
              <Select value={defaultPaymentType} onValueChange={(v) => setDefaultPaymentType(v as 'CASH' | 'MONTHLY')}>
                <SelectTrigger className="h-10 rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="CASH">Cash</SelectItem>
                  <SelectItem value="MONTHLY">Monthly billing</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {mapped('address') && mapped('area') && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4" checked={areaIntoAddress} onChange={(e) => setAreaIntoAddress(e.target.checked)} />
              Add the area / block to the end of the address
            </label>
          )}

          <div className="space-y-1.5 max-w-sm">
            <Label>Save this mapping for next time (optional)</Label>
            <Input className="h-10 rounded-xl" placeholder="e.g. My customer sheet" value={saveName} onChange={(e) => setSaveName(e.target.value)} />
          </div>
        </CardContent>
      </Card>
      )}

      {(problems.length > 0 || serverError) && (
        <div className="flex items-start gap-2 rounded-xl bg-amber-500/10 text-amber-700 dark:text-amber-400 p-3 text-sm">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <ul className="space-y-0.5">
            {problems.map((p) => <li key={p}>{p}</li>)}
            {serverError && <li className="font-medium">{serverError}</li>}
          </ul>
        </div>
      )}

      <div className="flex justify-end">
        <Button className="rounded-full gap-2 px-6" disabled={problems.length > 0 || save.isPending} onClick={submit}>
          {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Preview import <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
