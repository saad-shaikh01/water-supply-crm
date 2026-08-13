'use client';

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@water-supply-crm/ui';
import { AlertTriangle, Fuel, Plus, Receipt, Wallet } from 'lucide-react';

interface AddRecordMenuProps {
  canLogFuel: boolean;
  canAddExpense: boolean;
  canAddCrewCash: boolean;
  canAddDelivery: boolean;
  isClosed: boolean;
  canReportDamage: boolean;
  onLogFuel: () => void;
  onAddExpense: () => void;
  onAddCrewCash: () => void;
  onAddDelivery: () => void;
  onReportDamage: () => void;
}

/**
 * Unified "+ Add / Record" launcher for the Daily Sheet detail page — consolidates
 * the previously scattered Fuel Fill / Expense / Crew Cash / Missed-Ad-hoc Delivery /
 * Damage-Incident buttons into a single menu. Each item just triggers the same
 * externally-controlled dialog/state that the old standalone button used to.
 */
export function AddRecordMenu({
  canLogFuel,
  canAddExpense,
  canAddCrewCash,
  canAddDelivery,
  canReportDamage,
  onLogFuel,
  onAddExpense,
  onAddCrewCash,
  onAddDelivery,
  onReportDamage,
}: AddRecordMenuProps) {
  if (!canLogFuel && !canAddExpense && !canAddCrewCash && !canAddDelivery && !canReportDamage) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Plus className="h-4 w-4" />
          + Add / Record
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[220px]">
        {canLogFuel && (
          <DropdownMenuItem onClick={onLogFuel} className="gap-2 cursor-pointer">
            <Fuel className="h-4 w-4" />
            Fuel Fill
          </DropdownMenuItem>
        )}
        {canAddExpense && (
          <DropdownMenuItem onClick={onAddExpense} className="gap-2 cursor-pointer">
            <Receipt className="h-4 w-4" />
            Expense
          </DropdownMenuItem>
        )}
        {canAddCrewCash && (
          <DropdownMenuItem onClick={onAddCrewCash} className="gap-2 cursor-pointer">
            <Wallet className="h-4 w-4" />
            Crew Cash
          </DropdownMenuItem>
        )}
        {canAddDelivery && (
          <DropdownMenuItem onClick={onAddDelivery} className="gap-2 cursor-pointer">
            <Plus className="h-4 w-4" />
            Missed / Ad-hoc Delivery
          </DropdownMenuItem>
        )}
        {canReportDamage && (
          <DropdownMenuItem onClick={onReportDamage} className="gap-2 cursor-pointer">
            <AlertTriangle className="h-4 w-4" />
            Damage / Incident
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
