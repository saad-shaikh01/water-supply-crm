'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@water-supply-crm/ui';
import { dailySheetsApi } from '../../daily-sheets/api/daily-sheets.api';
import { useDailySheet } from '../../daily-sheets/hooks/use-daily-sheets';

export interface SheetPickerSelection {
  id: string;
  crewMembers: { id: string; name: string }[];
}

interface SheetPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `null` only ever fires when `optional` is true — the user chose to skip attaching a sheet. */
  onSelect: (sheet: SheetPickerSelection | null) => void;
  /** Trip Expense may skip this step; Crew Cash may not. */
  optional?: boolean;
}

const SKIP_VALUE = '__skip__';

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Mandatory (Crew Cash) or optional (Trip Expense) intermediate step —
 * lets the user pick one of today's OPEN route sheets, then resolves that
 * sheet's confirmed crew (driver + DailySheetCrew) exactly as
 * `sheet-detail.tsx`'s `crewCashEmployees` does, before handing off.
 *
 * Deliberately queries `dailySheetsApi` directly with its own `useQuery`
 * (not the exported `useDailySheets` hook) — that hook binds its
 * `page`/`limit`/`from`/`to`/`isClosed`/`vanId`/... filters to nuqs URL query
 * keys, the SAME keys the Expenses page's own `DateRangePicker` and
 * `ExpenseTimeline` pagination already use. Mounting it here would silently
 * scope "today's open sheets" to whatever date range/page the Expenses page
 * happens to have selected.
 */
export function SheetPickerDialog({ open, onOpenChange, onSelect, optional = false }: SheetPickerDialogProps) {
  const [sheetId, setSheetId] = useState('');
  const today = todayIso();

  const { data, isLoading } = useQuery({
    queryKey: ['sheets', 'wizard-open-today', today],
    queryFn: () => dailySheetsApi.getAll({ date: today, isClosed: false, limit: 100 }).then((r) => r.data),
    enabled: open,
  });

  const openSheets = useMemo(() => {
    const rows = ((data as { data?: unknown[] } | undefined)?.data ?? []) as Array<{
      id: string;
      date: string;
      isClosed: boolean;
      van: { id: string; plateNumber: string } | null;
    }>;
    // Safety net — the API already filters on isClosed, but this endpoint's
    // contract doesn't guarantee it the way a dedicated one would.
    return rows.filter((s) => !s.isClosed);
  }, [data]);

  const noOpenSheets = !isLoading && openSheets.length === 0;
  // A skip can happen two ways: the user explicitly picks "Skip — no sheet"
  // from the dropdown, or there simply are no open sheets to pick from at all
  // (the dropdown isn't even rendered in that case — see below).
  const isSkip = sheetId === SKIP_VALUE || (optional && noOpenSheets);
  const { data: sheetDetail, isLoading: isDetailLoading } = useDailySheet(!isSkip ? sheetId : '');

  const crewMembers = useMemo(() => {
    const members: { id: string; name: string }[] = [];
    if (sheetDetail?.driver) members.push({ id: sheetDetail.driver.id, name: sheetDetail.driver.name });
    for (const c of sheetDetail?.crew ?? []) {
      if (!members.some((m) => m.id === c.userId)) members.push({ id: c.userId, name: c.user.name });
    }
    return members;
  }, [sheetDetail]);

  const reset = () => setSheetId('');

  const handleContinue = () => {
    if (isSkip) {
      onSelect(null);
      reset();
      return;
    }
    if (!sheetId || !sheetDetail) return;
    onSelect({ id: sheetId, crewMembers });
    reset();
  };

  const canContinue = isSkip || (!!sheetId && !!sheetDetail && !isDetailLoading);

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent className="rounded-3xl max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-primary" />
            Select Today&apos;s Sheet
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-2 py-2">
          <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
            Daily Sheet {!optional && <span className="text-destructive">*</span>}
          </Label>

          {noOpenSheets ? (
            <p className="text-xs text-muted-foreground">
              No open route sheets today{optional ? ' — you can continue without one.' : '.'}
            </p>
          ) : (
            <Select value={sheetId} onValueChange={setSheetId} disabled={isLoading}>
              <SelectTrigger className="h-10 rounded-xl">
                <SelectValue placeholder={isLoading ? 'Loading sheets…' : 'Select a sheet'} />
              </SelectTrigger>
              <SelectContent>
                {openSheets.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.van?.plateNumber ?? 'No van'} — {new Date(s.date).toLocaleDateString('en-PK', { day: 'numeric', month: 'short' })}
                  </SelectItem>
                ))}
                {optional && <SelectItem value={SKIP_VALUE}>Skip — no sheet</SelectItem>}
              </SelectContent>
            </Select>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          {(openSheets.length > 0 || optional) && (
            <Button onClick={handleContinue} disabled={!canContinue} className="rounded-xl font-bold">
              {isDetailLoading && !isSkip ? 'Loading…' : 'Continue'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
