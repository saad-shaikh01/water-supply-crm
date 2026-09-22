'use client';

import { useMemo, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import {
  Badge,
  Button,
  Label,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@water-supply-crm/ui';
import { useEligibleEmployees } from '../../payroll/hooks/use-eligible-employees';
import { useExtraLabourOptions } from '../../extra-labour/hooks/use-extra-labour';
import { CASH_LEDGER_CATEGORY_GROUPS } from '../../van-cash-ledger/hooks/use-cash-ledger-filters';
import { useExpenseCenterTimeline } from '../hooks/use-expense-center';

// ── Staged (draft) state ─────────────────────────────────────────────────────
// Edits live here until Apply; the quick Domain/Van/Source controls in the
// toolbar write straight to the URL instead.

interface Draft {
  category: string;
  employeeId: string;
  extraLabourId: string;
  paymentMethod: '' | 'CASH' | 'CARD';
}

const EMPTY_DRAFT: Draft = { category: '', employeeId: '', extraLabourId: '', paymentMethod: '' };

const ANY = '__any__';

function PickerSelect({
  label, value, onChange, options, placeholder, unresolvedLabel = 'Selected',
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
  placeholder: string;
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

function CategorySelect({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-semibold">Category</Label>
      <Select value={value || ANY} onValueChange={(v) => onChange(v === ANY ? '' : v)}>
        <SelectTrigger className="h-11 sm:h-10 rounded-xl bg-background/50 border-border/50 text-xs">
          <SelectValue placeholder="Any category" />
        </SelectTrigger>
        <SelectContent className="rounded-xl border-border/50 shadow-2xl max-h-80">
          <SelectItem value={ANY}>Any category</SelectItem>
          {CASH_LEDGER_CATEGORY_GROUPS.map((group) => (
            <SelectGroup key={group.key}>
              <SelectLabel className="text-[10px] font-black uppercase tracking-widest">{group.label}</SelectLabel>
              {group.options.map((o) => (
                <SelectItem key={o.value} value={o.value} className="rounded-lg">{o.label}</SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function DrawerBody({ onClose }: { onClose: () => void }) {
  const {
    category, setCategory,
    employeeId, setEmployeeId,
    extraLabourId, setExtraLabourId,
    paymentMethod, setPaymentMethod,
  } = useExpenseCenterTimeline();

  const [draft, setDraft] = useState<Draft>(() => ({
    category: category || '',
    employeeId: employeeId || '',
    extraLabourId: extraLabourId || '',
    paymentMethod: (paymentMethod as Draft['paymentMethod']) || '',
  }));
  const patch = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const employees = useEligibleEmployees().data;
  const employeeOptions = useMemo(
    () => [...(employees ?? [])].sort((a, b) => a.name.localeCompare(b.name)).map((u) => ({ value: u.id, label: u.name })),
    [employees],
  );
  // isActive=false -> every labourer, active or not (a filter should still find an inactive worker's past payments).
  const extraLabourers = useExtraLabourOptions(undefined, undefined, false).data;
  const extraLabourOptions = useMemo(
    () => (extraLabourers ?? []).map((l) => ({ value: l.id, label: l.name })),
    [extraLabourers],
  );

  const apply = () => {
    setCategory(draft.category || null);
    setEmployeeId(draft.employeeId || null);
    setExtraLabourId(draft.extraLabourId || null);
    setPaymentMethod(draft.paymentMethod || null);
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
          Narrow the expense timeline. The date range, domain, van and source live in the toolbar.
        </SheetDescription>
      </SheetHeader>

      <div className="flex-1 min-h-0 overflow-y-auto px-5 sm:px-6 py-5 space-y-5">
        <CategorySelect value={draft.category} onChange={(v) => patch('category', v)} />

        <PickerSelect
          label="Employee"
          value={draft.employeeId}
          onChange={(v) => patch('employeeId', v)}
          options={employeeOptions}
          placeholder="Anyone"
        />

        <div className="space-y-1.5">
          <PickerSelect
            label="Extra Labourer"
            value={draft.extraLabourId}
            onChange={(v) => patch('extraLabourId', v)}
            options={extraLabourOptions}
            placeholder="Anyone"
            unresolvedLabel="Selected worker"
          />
          <p className="text-[11px] text-muted-foreground">Only matches Expense rows paid to a specific extra labourer.</p>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs font-semibold">Payment Method</Label>
          <p className="text-[11px] text-muted-foreground -mt-1">Only narrows Expense rows — payroll spend has no card/cash concept.</p>
          <Select
            value={draft.paymentMethod || ANY}
            onValueChange={(v) => patch('paymentMethod', v === ANY ? '' : (v as Draft['paymentMethod']))}
          >
            <SelectTrigger className="h-11 sm:h-10 rounded-xl bg-background/50 border-border/50 text-xs">
              <SelectValue placeholder="Any" />
            </SelectTrigger>
            <SelectContent className="rounded-xl border-border/50 shadow-2xl">
              <SelectItem value={ANY}>Any</SelectItem>
              <SelectItem value="CASH" className="rounded-lg">Cash</SelectItem>
              <SelectItem value="CARD" className="rounded-lg">Card / Bank</SelectItem>
            </SelectContent>
          </Select>
        </div>
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
        <Button type="button" onClick={apply} className="h-11 flex-1 sm:flex-none sm:min-w-32 rounded-xl">
          Apply
        </Button>
      </SheetFooter>
    </>
  );
}

export function ExpenseFilterDrawer() {
  const [open, setOpen] = useState(false);
  const { category, employeeId, extraLabourId, paymentMethod } = useExpenseCenterTimeline();
  const drawerCount = [category, employeeId, extraLabourId, paymentMethod].filter(Boolean).length;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        aria-label={drawerCount > 0 ? `Filters, ${drawerCount} active` : 'Filters'}
        className={
          drawerCount > 0
            ? 'h-11 sm:h-10 gap-1.5 rounded-xl px-3 font-semibold shrink-0 border-primary text-primary'
            : 'h-11 sm:h-10 gap-1.5 rounded-xl px-3 font-semibold shrink-0'
        }
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
