'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, SlidersHorizontal } from 'lucide-react';
import {
  Badge,
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  cn,
} from '@water-supply-crm/ui';
import { VanFilter } from '../../../components/shared/filters/van-filter';
import { pktToday } from '../../../lib/date-pkt';
import { useCrewCandidates } from '../../users/hooks/use-users';
import { useEligibleEmployees } from '../../payroll/hooks/use-eligible-employees';
import { useExtraLabourOptions } from '../../extra-labour/hooks/use-extra-labour';
import type {
  CashLedgerStatusFilter,
  CashLedgerTimelineFilters,
  RemittanceDestination,
} from '../api/van-cash-ledger.api';
import {
  CASH_LEDGER_CATEGORY_GROUPS,
  CASH_LEDGER_DESTINATION_OPTIONS,
  CASH_LEDGER_STATUS_OPTIONS,
  useCashLedgerFilters,
} from '../hooks/use-cash-ledger-filters';

// ── Staged (draft) state ─────────────────────────────────────────────────────
// Edits live here until Apply; chips / flow chips / search write to the URL directly.

interface Draft {
  status: CashLedgerStatusFilter[];
  recordedFrom: string;
  recordedTo: string;
  backdatedOnly: boolean;
  editedOnly: boolean;
  recordedById: string;
  approvedById: string;
  employeeId: string;
  extraLabourId: string;
  categories: string[];
  minAmount: string;
  maxAmount: string;
  hasAttachment: boolean;
  hasNote: boolean;
  sheet: string;
  reference: string;
  destination: '' | RemittanceDestination;
}

const EMPTY_DRAFT: Draft = {
  status: [], recordedFrom: '', recordedTo: '', backdatedOnly: false, editedOnly: false,
  recordedById: '', approvedById: '', employeeId: '', extraLabourId: '', categories: [], minAmount: '', maxAmount: '',
  hasAttachment: false, hasNote: false, sheet: '', reference: '', destination: '',
};

const draftFrom = (f: CashLedgerTimelineFilters): Draft => ({
  status: f.status ? [...f.status] : [],
  recordedFrom: f.recordedFrom ?? '',
  recordedTo: f.recordedTo ?? '',
  backdatedOnly: !!f.backdatedOnly,
  editedOnly: !!f.editedOnly,
  recordedById: f.recordedById ?? '',
  approvedById: f.approvedById ?? '',
  employeeId: f.employeeId ?? '',
  extraLabourId: f.extraLabourId ?? '',
  categories: f.categories ? [...f.categories] : [],
  minAmount: f.minAmount !== undefined ? String(f.minAmount) : '',
  maxAmount: f.maxAmount !== undefined ? String(f.maxAmount) : '',
  hasAttachment: !!f.hasAttachment,
  hasNote: !!f.hasNote,
  sheet: f.sheet ?? '',
  reference: f.reference ?? '',
  destination: f.destination ?? '',
});

const parseAmount = (raw: string): number | undefined => {
  if (raw.trim() === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

/** Every drawer-owned filter key is listed (undefined = cleared) so Apply fully replaces this section's state. */
const draftToPatch = (d: Draft): CashLedgerTimelineFilters => ({
  status: d.status.length ? d.status : undefined,
  recordedFrom: d.recordedFrom || undefined,
  recordedTo: d.recordedTo || undefined,
  backdatedOnly: d.backdatedOnly || undefined,
  editedOnly: d.editedOnly || undefined,
  recordedById: d.recordedById || undefined,
  approvedById: d.approvedById || undefined,
  employeeId: d.employeeId || undefined,
  extraLabourId: d.extraLabourId || undefined,
  categories: d.categories.length ? d.categories : undefined,
  minAmount: parseAmount(d.minAmount),
  maxAmount: parseAmount(d.maxAmount),
  hasAttachment: d.hasAttachment || undefined,
  hasNote: d.hasNote || undefined,
  sheet: d.sheet.trim().replace(/^#/, '') || undefined,
  reference: d.reference.trim() || undefined,
  destination: d.destination || undefined,
});

function validate(d: Draft): Record<'recorded' | 'amount', string | null> {
  const lo = parseAmount(d.minAmount);
  const hi = parseAmount(d.maxAmount);
  const badNumber = (raw: string) => raw.trim() !== '' && parseAmount(raw) === undefined;
  return {
    recorded:
      d.recordedFrom && d.recordedTo && d.recordedFrom > d.recordedTo
        ? '“From” must not be after “To”.'
        : null,
    amount:
      badNumber(d.minAmount) || badNumber(d.maxAmount)
        ? 'Amounts must be numbers ≥ 0.'
        : lo !== undefined && hi !== undefined && lo > hi
          ? 'Minimum cannot be greater than maximum.'
          : null,
  };
}

// ── Small building blocks ────────────────────────────────────────────────────

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{title}</h3>
        {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function CheckRow({
  checked, onChange, label, hint,
}: { checked: boolean; onChange: (next: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex items-start gap-3 min-h-11 sm:min-h-9 cursor-pointer rounded-lg px-1 py-2 sm:py-1.5 hover:bg-accent/30">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 rounded border-border accent-primary"
      />
      <span className="min-w-0">
        <span className="text-sm font-semibold">{label}</span>
        {hint && <span className="block text-[11px] text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );
}

const ANY = '__any__';

function PickerSelect({
  label, value, onChange, options, placeholder, unresolvedLabel = 'Selected user',
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
  placeholder: string;
  /** Fallback row label when `value` isn't in `options` (e.g. a since-deactivated record). */
  unresolvedLabel?: string;
}) {
  // A selected id that is not in the (active) list — e.g. a since-deactivated record — stays selectable/visible.
  const list = value && !options.some((o) => o.value === value)
    ? [{ value, label: unresolvedLabel }, ...options]
    : options;
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-semibold">{label}</Label>
      <Select value={value || ANY} onValueChange={(v) => onChange(v === ANY ? '' : v)}>
        <SelectTrigger className="h-11 sm:h-10 rounded-xl bg-background/50 border-border/50 text-xs">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent className="rounded-xl border-border/50 shadow-2xl max-h-72">
          <SelectItem value={ANY}>{placeholder}</SelectItem>
          {list.map((o) => (
            <SelectItem key={o.value} value={o.value} className="rounded-lg">{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

const fieldClass = 'h-11 sm:h-10 rounded-xl bg-background/50 border-border/50 text-xs';

function CategoryPicker({ value, onChange }: { value: string[]; onChange: (next: string[]) => void }) {
  const selected = new Set(value);
  // Groups that already hold a selection start expanded. Captured once so ticking/unticking never collapses a group under the cursor.
  const [startOpen] = useState(
    () => new Set(CASH_LEDGER_CATEGORY_GROUPS.filter((g) => g.options.some((o) => value.includes(o.value))).map((g) => g.key)),
  );
  const toggle = (v: string) => {
    const next = new Set(selected);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    onChange(Array.from(next));
  };

  return (
    <div className="rounded-xl border border-border/50 divide-y divide-border/40">
      {CASH_LEDGER_CATEGORY_GROUPS.map((group) => {
        const count = group.options.filter((o) => selected.has(o.value)).length;
        return (
          <details key={group.key} className="group" open={startOpen.has(group.key) || undefined}>
            <summary className="flex min-h-11 sm:min-h-9 cursor-pointer list-none items-center gap-2 px-3 text-xs font-bold [&::-webkit-details-marker]:hidden">
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground -rotate-90 group-open:rotate-0" aria-hidden />
              <span className="flex-1">{group.label}</span>
              {count > 0 && (
                <Badge variant="primary" className="px-2 py-0 text-[10px]">{count}</Badge>
              )}
            </summary>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-2 px-3 pb-2">
              {group.options.map((o) => (
                <CheckRow key={o.value} checked={selected.has(o.value)} onChange={() => toggle(o.value)} label={o.label} />
              ))}
            </div>
          </details>
        );
      })}
    </div>
  );
}

// ── Drawer body (mounted only while the sheet is open, so the draft starts fresh each time) ──

function DrawerBody({ onClose }: { onClose: () => void }) {
  const { filters, setFilters } = useCashLedgerFilters();
  const [draft, setDraft] = useState<Draft>(() => draftFrom(filters));
  const patch = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const users = useCrewCandidates().data?.data;
  const employees = useEligibleEmployees().data;
  const userOptions = useMemo(
    () => [...(users ?? [])].sort((a, b) => a.name.localeCompare(b.name)).map((u) => ({ value: u.id, label: u.name })),
    [users],
  );
  const employeeOptions = useMemo(
    () => [...(employees ?? [])].sort((a, b) => a.name.localeCompare(b.name)).map((u) => ({ value: u.id, label: u.name })),
    [employees],
  );
  // isActive=false -> every labourer, active or not (a filter should still find an
  // inactive worker's past payments, unlike the payment-recording picker).
  const extraLabourers = useExtraLabourOptions(undefined, undefined, false).data;
  const extraLabourOptions = useMemo(
    () => (extraLabourers ?? []).map((l) => ({ value: l.id, label: l.name })),
    [extraLabourers],
  );

  const today = pktToday();
  const errors = validate(draft);
  const hasError = !!(errors.recorded || errors.amount);

  const toggleStatus = (s: CashLedgerStatusFilter, on: boolean) =>
    patch('status', on ? [...draft.status, s] : draft.status.filter((x) => x !== s));

  const apply = () => {
    if (hasError) return;
    setFilters(draftToPatch(draft));
    onClose();
  };

  return (
    <>
      <SheetHeader className="px-5 sm:px-6 pt-5 sm:pt-6 pb-4 pr-14 border-b shrink-0 text-left">
        <SheetTitle className="flex items-center gap-2 text-xl font-bold">
          <SlidersHorizontal className="h-5 w-5 text-primary" aria-hidden />
          Filters
        </SheetTitle>
        <SheetDescription className="text-xs">
          Narrow the timeline entries. Balances and day statements always describe the full date range.
        </SheetDescription>
      </SheetHeader>

      <div className="flex-1 min-h-0 overflow-y-auto px-5 sm:px-6 py-5 space-y-7">
        {/* Van lives in the toolbar on desktop; on mobile it moves here. Applies immediately, not staged. */}
        <div className="sm:hidden space-y-1.5">
          <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
            Van <span className="normal-case tracking-normal font-medium">(applies immediately)</span>
          </Label>
          <div className="[&_button]:w-full [&_button]:h-11">
            <VanFilter />
          </div>
        </div>

        <Section title="Recorded" hint="When the entry was recorded — not the business date it belongs to.">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">From</Label>
              <Input
                type="date"
                value={draft.recordedFrom}
                max={draft.recordedTo && draft.recordedTo < today ? draft.recordedTo : today}
                onChange={(e) => patch('recordedFrom', e.target.value)}
                className={fieldClass}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">To</Label>
              <Input
                type="date"
                value={draft.recordedTo}
                min={draft.recordedFrom || undefined}
                max={today}
                onChange={(e) => patch('recordedTo', e.target.value)}
                className={fieldClass}
              />
            </div>
          </div>
          {errors.recorded && <p role="alert" className="text-[11px] font-semibold text-destructive">{errors.recorded}</p>}
          <div>
            <CheckRow
              checked={draft.backdatedOnly}
              onChange={(v) => patch('backdatedOnly', v)}
              label="Backdated only"
              hint="Recorded on a later day than their business date"
            />
            <CheckRow
              checked={draft.editedOnly}
              onChange={(v) => patch('editedOnly', v)}
              label="Edited only"
              hint="Changed after they were created"
            />
          </div>
        </Section>

        <Section title="People">
          <PickerSelect
            label="Recorded by"
            value={draft.recordedById}
            onChange={(v) => patch('recordedById', v)}
            options={userOptions}
            placeholder="Anyone"
          />
          <PickerSelect
            label="Approved by"
            value={draft.approvedById}
            onChange={(v) => patch('approvedById', v)}
            options={userOptions}
            placeholder="Anyone"
          />
          <PickerSelect
            label="Employee / Driver"
            value={draft.employeeId}
            onChange={(v) => patch('employeeId', v)}
            options={employeeOptions}
            placeholder="Anyone"
          />
        </Section>

        <Section title="Extra Labour" hint="Only matches Office Expense rows paid to a specific extra labourer.">
          <PickerSelect
            label="Extra Labourer"
            value={draft.extraLabourId}
            onChange={(v) => patch('extraLabourId', v)}
            options={extraLabourOptions}
            placeholder="Anyone"
            unresolvedLabel="Selected worker"
          />
        </Section>

        <Section title="Category" hint="Expense, payroll and crew-cash categories.">
          <CategoryPicker value={draft.categories} onChange={(v) => patch('categories', v)} />
        </Section>

        <Section title="Status">
          <div>
            {CASH_LEDGER_STATUS_OPTIONS.map((o) => (
              <CheckRow
                key={o.value}
                checked={draft.status.includes(o.value)}
                onChange={(on) => toggleStatus(o.value, on)}
                label={o.label}
              />
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Pending shows entries still awaiting approval — they don&apos;t move the balance.
          </p>
        </Section>

        <Section title="Amount">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Min (₨)</Label>
              <Input
                type="number"
                inputMode="decimal"
                min={0}
                placeholder="0"
                value={draft.minAmount}
                onChange={(e) => patch('minAmount', e.target.value)}
                className={fieldClass}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Max (₨)</Label>
              <Input
                type="number"
                inputMode="decimal"
                min={0}
                placeholder="No limit"
                value={draft.maxAmount}
                onChange={(e) => patch('maxAmount', e.target.value)}
                className={fieldClass}
              />
            </div>
          </div>
          {errors.amount && <p role="alert" className="text-[11px] font-semibold text-destructive">{errors.amount}</p>}
        </Section>

        <Section title="Details">
          <div>
            <CheckRow checked={draft.hasAttachment} onChange={(v) => patch('hasAttachment', v)} label="Has attachment" />
            <CheckRow checked={draft.hasNote} onChange={(v) => patch('hasNote', v)} label="Has note" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Sheet number</Label>
              <Input
                value={draft.sheet}
                onChange={(e) => patch('sheet', e.target.value)}
                placeholder="#A1B2C3D4"
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                className={cn(fieldClass, 'font-mono')}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Reference</Label>
              <Input
                value={draft.reference}
                onChange={(e) => patch('reference', e.target.value)}
                placeholder="Receipt / txn no."
                autoComplete="off"
                className={fieldClass}
              />
            </div>
          </div>
          <PickerSelect
            label="Transfer destination"
            value={draft.destination}
            onChange={(v) => patch('destination', v as Draft['destination'])}
            options={CASH_LEDGER_DESTINATION_OPTIONS}
            placeholder="Any destination"
          />
          <p className="-mt-1 text-[11px] text-muted-foreground">Applies to owner transfers only.</p>
        </Section>
      </div>

      <SheetFooter className="px-5 sm:px-6 py-3 border-t shrink-0 flex-row gap-2 sm:space-x-0 sm:justify-between">
        <Button
          type="button"
          variant="outline"
          onClick={() => setDraft(EMPTY_DRAFT)}
          className="h-11 flex-1 sm:flex-none sm:min-w-28 rounded-xl"
        >
          Reset
        </Button>
        <Button
          type="button"
          onClick={apply}
          disabled={hasError}
          className="h-11 flex-1 sm:flex-none sm:min-w-32 rounded-xl"
        >
          Apply
        </Button>
      </SheetFooter>
    </>
  );
}

interface Props {
  /** Table view: entry filters do not apply, so the trigger is inert. */
  disabled?: boolean;
}

/**
 * "Filters" button (with a count badge) + the right-hand filter drawer. Edits are
 * staged locally and written to the URL only on Apply; Reset clears the staged
 * values (Apply then commits the cleared state).
 */
export function CashLedgerFilterDrawer({ disabled }: Props) {
  const [open, setOpen] = useState(false);
  const { drawerCount } = useCashLedgerFilters();

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => setOpen(true)}
        aria-label={drawerCount > 0 ? `Filters, ${drawerCount} active` : 'Filters'}
        className={cn(
          'h-11 sm:h-10 gap-1.5 rounded-xl px-3 font-semibold shrink-0',
          drawerCount > 0 && 'border-primary text-primary',
        )}
      >
        <SlidersHorizontal className="h-4 w-4" aria-hidden />
        Filters
        {drawerCount > 0 && (
          <Badge className="h-5 min-w-5 px-1 flex items-center justify-center rounded-full text-[10px] font-black">
            {drawerCount}
          </Badge>
        )}
      </Button>

      <SheetContent
        side="right"
        className="w-full sm:max-w-md bg-background/95 backdrop-blur-xl border-l border-border/50 flex flex-col gap-0 p-0"
      >
        {open && <DrawerBody onClose={() => setOpen(false)} />}
      </SheetContent>
    </Sheet>
  );
}
