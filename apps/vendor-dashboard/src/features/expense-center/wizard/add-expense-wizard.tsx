'use client';

import { useEffect, useMemo, useState } from 'react';
import { ExpenseForm } from '../../expenses/components/expense-form';
import { FuelLogFormDialog } from '../../fleet/components/dialogs/fuel-log-form-dialog';
import { ServiceRecordFormDialog } from '../../fleet/components/dialogs/service-record-form-dialog';
import { LogLedgerEntryDialog } from '../../payroll/components/log-ledger-entry-dialog';
import { CrewCashForm } from '../../crew-cash/components/crew-cash-form';
import { ExpenseTypePicker } from './expense-type-picker';
import { VehiclePickerDialog } from './vehicle-picker-dialog';
import { SheetPickerDialog, type SheetPickerSelection } from './sheet-picker-dialog';
import { useRecentExpenseTypes } from './use-recent-expense-types';
import type { ExpenseTypeEntry } from './expense-types';

type WizardStage =
  | 'picker'
  | 'vehicle-picker'
  | 'sheet-picker'
  | 'fuel'
  | 'maintenance'
  | 'ledger'
  | 'crew-cash'
  | 'expense';

interface AddExpenseWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Phase 2a "Add Expense" wizard — a state machine that hands off between the
 * four reused domain dialogs (`FuelLogFormDialog`, `ServiceRecordFormDialog`,
 * `LogLedgerEntryDialog`, `CrewCashForm`) plus the plain `ExpenseForm` sheet,
 * without ever nesting one inside another. Only one stage's dialog is ever
 * rendered `open` at a time, so from the user's point of view one dialog
 * closes at the exact instant the next opens.
 *
 * Whenever the currently-active stage reports `onOpenChange(false)` — for any
 * reason: Cancel, Escape, or (for Fuel/Maintenance/Ledger) a successful
 * submit that closes itself — the whole wizard closes and resets back to the
 * type picker for next time. Crew Cash's own dialog deliberately stays open
 * after a successful add (its documented "quick-repeat" UX) and only signals
 * `onOpenChange(false)` when the user taps Done/Cancel — at which point the
 * wizard closes the same way.
 */
export function AddExpenseWizard({ open, onOpenChange }: AddExpenseWizardProps) {
  const [stage, setStage] = useState<WizardStage>('picker');
  const [selectedEntry, setSelectedEntry] = useState<ExpenseTypeEntry | null>(null);
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [sheetSelection, setSheetSelection] = useState<SheetPickerSelection | null>(null);
  const { recordUse } = useRecentExpenseTypes();

  // Always start fresh at the type picker on every new open.
  useEffect(() => {
    if (open) {
      setStage('picker');
      setSelectedEntry(null);
      setVehicleId(null);
      setSheetSelection(null);
    }
  }, [open]);

  const closeWizard = () => onOpenChange(false);

  const handleTypeSelect = (entry: ExpenseTypeEntry) => {
    recordUse(entry.key);
    setSelectedEntry(entry);
    switch (entry.kind) {
      case 'FUEL':
      case 'MAINTENANCE':
        setStage('vehicle-picker');
        break;
      case 'CREW_CASH':
        setStage('sheet-picker');
        break;
      case 'LEDGER':
        setStage('ledger');
        break;
      case 'EXPENSE':
        setStage(entry.needsSheetContext ? 'sheet-picker' : 'expense');
        break;
      default:
        break;
    }
  };

  const handleVehicleSelect = (id: string) => {
    setVehicleId(id);
    setStage(selectedEntry?.kind === 'FUEL' ? 'fuel' : 'maintenance');
  };

  const handleSheetSelect = (sheet: SheetPickerSelection | null) => {
    setSheetSelection(sheet);
    setStage(selectedEntry?.kind === 'CREW_CASH' ? 'crew-cash' : 'expense');
  };

  // ExpenseForm's `expense` prop doubles as "initial values" whenever the
  // object has no `id` (isEdit stays false, so submit still goes through
  // create/createForSheet) — the cleanest way to preset its category without
  // touching that file, per this pass's "reused as-is" constraint. Memoized
  // on `selectedEntry` only, so the Sheet's fields don't get reset mid-typing
  // by an unrelated parent re-render creating a new object each time.
  const expenseInitialValues = useMemo(() => {
    if (!selectedEntry || selectedEntry.kind !== 'EXPENSE') return undefined;
    return { category: selectedEntry.presetExpenseCategory } as Record<string, unknown>;
  }, [selectedEntry]);

  return (
    <>
      <ExpenseTypePicker
        open={open && stage === 'picker'}
        onOpenChange={(o) => { if (!o) closeWizard(); }}
        onSelect={handleTypeSelect}
      />

      <VehiclePickerDialog
        open={open && stage === 'vehicle-picker'}
        onOpenChange={(o) => { if (!o) closeWizard(); }}
        onSelect={handleVehicleSelect}
      />

      <SheetPickerDialog
        open={open && stage === 'sheet-picker'}
        onOpenChange={(o) => { if (!o) closeWizard(); }}
        onSelect={handleSheetSelect}
        optional={selectedEntry?.kind === 'EXPENSE'}
      />

      {stage === 'fuel' && vehicleId && (
        <FuelLogFormDialog
          vehicleId={vehicleId}
          open={open}
          onOpenChange={(o) => { if (!o) closeWizard(); }}
        />
      )}

      {stage === 'maintenance' && vehicleId && (
        <ServiceRecordFormDialog
          vehicleId={vehicleId}
          open={open}
          onOpenChange={(o) => { if (!o) closeWizard(); }}
        />
      )}

      {stage === 'ledger' && selectedEntry?.presetLedgerCategory && (
        <LogLedgerEntryDialog
          open={open}
          onOpenChange={(o) => { if (!o) closeWizard(); }}
          defaultCategory={selectedEntry.presetLedgerCategory}
        />
      )}

      {stage === 'crew-cash' && sheetSelection && (
        <CrewCashForm
          open={open}
          onOpenChange={(o) => { if (!o) closeWizard(); }}
          sheetId={sheetSelection.id}
          employees={sheetSelection.crewMembers}
        />
      )}

      {stage === 'expense' && (
        <ExpenseForm
          open={open}
          onOpenChange={(o) => { if (!o) closeWizard(); }}
          expense={expenseInitialValues}
          dailySheetId={sheetSelection?.id}
        />
      )}
    </>
  );
}
