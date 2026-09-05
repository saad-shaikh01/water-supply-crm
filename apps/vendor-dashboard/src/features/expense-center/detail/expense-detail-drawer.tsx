'use client';

import { useEffect, useState } from 'react';
import { Pencil, Trash2, Lock } from 'lucide-react';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
  Badge, Button, Separator, cn,
} from '@water-supply-crm/ui';
import { ConfirmDialog } from '../../../components/shared/confirm-dialog';
import { domainMeta } from '../constants';
import type { ExpenseCenterRow } from '../api/expense-center.api';
import { useExpense, useDeleteExpense } from '../../expenses/hooks/use-expenses';
import { ExpenseForm } from '../../expenses/components/expense-form';
import { useFuelLog, useRemoveFuelLog } from '../../fleet/hooks/use-fuel-logs';
import { FuelLogFormDialog } from '../../fleet/components/dialogs/fuel-log-form-dialog';
import { useServiceRecord, useDeleteServiceRecord } from '../../fleet/hooks/use-maintenance';
import { ServiceRecordFormDialog } from '../../fleet/components/dialogs/service-record-form-dialog';

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' });

interface ExpenseDetailDrawerProps {
  row: ExpenseCenterRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Phase 2b (§08) — the Timeline row's read-only detail panel + edit routing.
 *
 * Deliberately a `Sheet` (matching `expense-form.tsx`'s side-panel convention),
 * not a `Dialog` — this is a detail *drawer*, and its own Edit action then
 * hands off to whichever domain dialog actually owns that record (a second,
 * separate overlay — the drawer never embeds another form inline).
 *
 * Routing by `sourceType`:
 *  - `EXPENSE` / `FUEL_LOG` / `VEHICLE_SERVICE`: Edit (opens that domain's own
 *    reused form, pre-filled from a fresh fetch-by-id) + Delete (with confirm).
 *  - `CREW_CASH` / `STAFF_LEDGER`: never edited here — both are only ever
 *    corrected from inside their owning module's own UI (Daily Sheet's Crew
 *    Cash section / Payroll). The Timeline row doesn't carry a `dailySheetId`
 *    or `employeeId` to link straight there, so rather than guess a URL this
 *    only shows explanatory text (see contract note in expense-center.api.ts).
 *  - Any `locked` row (regardless of sourceType): shows `lockedReason` and
 *    stops — no action of any kind.
 */
export function ExpenseDetailDrawer({ row, open, onOpenChange }: ExpenseDetailDrawerProps) {
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  // Reset the child dialogs' state whenever the drawer closes or swaps rows,
  // so a stale Edit/Delete overlay from the previous row can never reopen.
  useEffect(() => {
    if (!open) {
      setEditOpen(false);
      setDeleteOpen(false);
    }
  }, [open, row?.id]);

  const isExpense = row?.sourceType === 'EXPENSE';
  const isFuelLog = row?.sourceType === 'FUEL_LOG';
  const isService = row?.sourceType === 'VEHICLE_SERVICE';
  const editable = !row?.locked && (isExpense || isFuelLog || isService);

  // Each full-record fetch is scoped to its own sourceType so only one of
  // the three ever actually hits the network for a given row.
  const { data: expenseRecord, isFetching: isExpenseLoading } = useExpense(
    open && isExpense ? row?.sourceRecordId : undefined,
  );
  const { data: fuelLogRecord, isFetching: isFuelLoading } = useFuelLog(
    open && isFuelLog ? row?.sourceRecordId : undefined,
  );
  const { data: serviceRecord, isFetching: isServiceLoading } = useServiceRecord(
    open && isService ? row?.sourceRecordId : undefined,
  );

  const isRecordLoading = isExpense ? isExpenseLoading : isFuelLog ? isFuelLoading : isService ? isServiceLoading : false;
  const recordReady = isExpense ? !!expenseRecord : isFuelLog ? !!fuelLogRecord : isService ? !!serviceRecord : false;

  const { mutate: deleteExpense, isPending: isDeletingExpense } = useDeleteExpense();
  const { mutate: deleteFuelLog, isPending: isDeletingFuelLog } = useRemoveFuelLog();
  const { mutate: deleteServiceRecord, isPending: isDeletingService } = useDeleteServiceRecord();
  const isDeleting = isDeletingExpense || isDeletingFuelLog || isDeletingService;

  const handleDelete = () => {
    if (!row) return;
    const onSuccess = () => {
      setDeleteOpen(false);
      onOpenChange(false);
    };
    if (isExpense) deleteExpense(row.sourceRecordId, { onSuccess });
    else if (isFuelLog) deleteFuelLog(row.sourceRecordId, { onSuccess });
    else if (isService) deleteServiceRecord(row.sourceRecordId, { onSuccess });
  };

  if (!row) return null;

  const meta = domainMeta(row.domain);
  const metadata = [
    row.employeeName,
    row.recordedByName ? `by ${row.recordedByName}` : null,
  ].filter(Boolean) as string[];

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-[400px] sm:w-[480px]">
          <SheetHeader>
            <SheetTitle>{row.title}</SheetTitle>
            <SheetDescription>{row.categoryLabel}</SheetDescription>
          </SheetHeader>

          <div className="space-y-5 mt-6">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full border-none', meta.color)}>
                {meta.label}
              </Badge>
              <Badge variant="secondary" className="text-[10px] font-medium">{row.sourceBadge}</Badge>
              {row.vanPlateNumber && (
                <Badge variant="secondary" className="text-[10px] font-mono">{row.vanPlateNumber}</Badge>
              )}
            </div>

            {/* Same cost-tone rule as the Timeline row — every amount renders
                in the same destructive tone regardless of `costSign`. A
                payroll CREDIT is still a real business cost, never revenue,
                so it never gets a green figure. */}
            <div className="rounded-2xl border border-border/40 bg-card/50 p-4">
              <p className="font-mono font-black text-2xl text-destructive">
                ₨ {Number(row.amount).toLocaleString()}
              </p>
              {row.costSign === 'CREDIT' && (
                <p className="text-[10px] text-muted-foreground lowercase mt-1">credit to employee</p>
              )}
            </div>

            <Separator />

            <dl className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">Date</dt>
                <dd className="font-semibold">{fmtDate(row.date)}</dd>
              </div>
              {row.recordedByName && (
                <div className="flex items-center justify-between">
                  <dt className="text-muted-foreground">Recorded By</dt>
                  <dd className="font-semibold">{row.recordedByName}</dd>
                </div>
              )}
              {row.employeeName && (
                <div className="flex items-center justify-between">
                  <dt className="text-muted-foreground">Employee</dt>
                  <dd className="font-semibold">{row.employeeName}</dd>
                </div>
              )}
              {row.vanPlateNumber && (
                <div className="flex items-center justify-between">
                  <dt className="text-muted-foreground">Van</dt>
                  <dd className="font-semibold font-mono">{row.vanPlateNumber}</dd>
                </div>
              )}
              {metadata.length > 0 && !row.recordedByName && !row.employeeName && (
                <div className="flex items-center justify-between">
                  <dt className="text-muted-foreground">Details</dt>
                  <dd className="font-semibold">{metadata.join(' · ')}</dd>
                </div>
              )}
            </dl>

            <Separator />

            {/* Locked always wins — regardless of sourceType, a locked row
                stops here with an explanatory message and no action. */}
            {row.locked ? (
              <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3">
                <Lock className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                <p className="text-xs font-semibold text-amber-700 dark:text-amber-500">
                  {row.lockedReason ?? 'This entry is locked and can no longer be edited.'}
                </p>
              </div>
            ) : editable ? (
              <div className="flex gap-2">
                <Button
                  className="flex-1 rounded-xl font-bold"
                  disabled={isRecordLoading && !recordReady}
                  onClick={() => setEditOpen(true)}
                >
                  <Pencil className="h-3.5 w-3.5 mr-2" />
                  {isRecordLoading && !recordReady ? 'Loading...' : 'Edit'}
                </Button>
                <Button
                  variant="outline"
                  className="rounded-xl font-bold text-destructive hover:text-destructive"
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : row.sourceType === 'CREW_CASH' ? (
              // The Timeline row doesn't carry a `dailySheetId` — nothing to
              // build a `/dashboard/daily-sheets/:id` link from, so this is
              // deliberately text-only rather than a guessed URL. `sourceBadge`
              // already names the sheet (e.g. "via Daily Sheet #482").
              <p className="text-xs text-muted-foreground">
                Crew Cash entries are added/edited/removed from their own Daily Sheet's Crew Cash section — see{' '}
                <span className="font-semibold text-foreground">{row.sourceBadge}</span> above.
              </p>
            ) : row.sourceType === 'STAFF_LEDGER' ? (
              // Same reasoning — no `employeeId` on the row to build
              // `/dashboard/payroll/employees/:id` from, so no guessed link.
              <p className="text-xs text-muted-foreground">
                Staff Ledger entries have no plain field-level edit — they can only be voided, reversed, or
                corrected from inside the Payroll module.
              </p>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>

      {isExpense && (
        <ExpenseForm
          open={editOpen && !!expenseRecord}
          onOpenChange={setEditOpen}
          expense={expenseRecord as unknown as Record<string, unknown> | null}
          onAfterSuccess={() => onOpenChange(false)}
        />
      )}

      {isFuelLog && fuelLogRecord && (
        <FuelLogFormDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          fuelLog={fuelLogRecord}
        />
      )}

      {isService && serviceRecord && (
        <ServiceRecordFormDialog
          vehicleId={serviceRecord.vehicleId}
          open={editOpen}
          onOpenChange={setEditOpen}
          serviceRecord={serviceRecord}
        />
      )}

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete Entry"
        description="Are you sure? This action cannot be undone."
        onConfirm={handleDelete}
        isLoading={isDeleting}
        confirmLabel="Delete"
      />
    </>
  );
}
