'use client';

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@water-supply-crm/ui';
import { AlertTriangle, Fuel, HandCoins, PackagePlus, Plus, Receipt, Wallet, Wrench } from 'lucide-react';

interface AddRecordMenuProps {
  canLogFuel: boolean;
  canAddExpense: boolean;
  canAddCrewCash: boolean;
  /** Shortcut into the Expense form pre-set to the Extra Labour category (uses the Expense permission). */
  canAddExtraLabour?: boolean;
  /** Salary advance paid from the van's cash (payroll:ledger_create, + the closed-sheet permission when closed). */
  canAddAdvance?: boolean;
  /** Vehicle maintenance record for this sheet's vehicle (fleet:manage_maintenance). */
  canAddMaintenance?: boolean;
  canAddDelivery: boolean;
  isClosed: boolean;
  canReportDamage: boolean;
  onLogFuel: () => void;
  onAddExpense: () => void;
  onAddCrewCash: () => void;
  onAddExtraLabour?: () => void;
  onAddAdvance?: () => void;
  onAddMaintenance?: () => void;
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
  canAddExtraLabour = false,
  canAddAdvance = false,
  canAddMaintenance = false,
  canAddDelivery,
  canReportDamage,
  onLogFuel,
  onAddExpense,
  onAddCrewCash,
  onAddExtraLabour,
  onAddAdvance,
  onAddMaintenance,
  onAddDelivery,
  onReportDamage,
}: AddRecordMenuProps) {
  if (!canLogFuel && !canAddExpense && !canAddCrewCash && !canAddExtraLabour && !canAddAdvance && !canAddMaintenance && !canAddDelivery && !canReportDamage) {
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
        {canAddExtraLabour && onAddExtraLabour && (
          <DropdownMenuItem onClick={onAddExtraLabour} className="gap-2 cursor-pointer">
            <PackagePlus className="h-4 w-4" />
            Extra Labour
          </DropdownMenuItem>
        )}
        {canAddCrewCash && (
          <DropdownMenuItem onClick={onAddCrewCash} className="gap-2 cursor-pointer">
            <Wallet className="h-4 w-4" />
            Crew Cash
          </DropdownMenuItem>
        )}
        {canAddAdvance && onAddAdvance && (
          <DropdownMenuItem onClick={onAddAdvance} className="gap-2 cursor-pointer">
            <HandCoins className="h-4 w-4" />
            Advance
          </DropdownMenuItem>
        )}
        {canAddMaintenance && onAddMaintenance && (
          <DropdownMenuItem onClick={onAddMaintenance} className="gap-2 cursor-pointer">
            <Wrench className="h-4 w-4" />
            Vehicle Maintenance
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
