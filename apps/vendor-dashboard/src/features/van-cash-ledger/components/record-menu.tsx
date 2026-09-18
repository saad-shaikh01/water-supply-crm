'use client';

import { ChevronDown, Fuel, HandCoins, Landmark, Plus, Receipt } from 'lucide-react';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  cn,
} from '@water-supply-crm/ui';
import { useCan } from '../../authz/hooks/use-can';
import { FUEL_CARD_PERMISSIONS } from '../../fuel-cards/constants';
import { VAN_CASH_LEDGER_PERMISSIONS } from '../constants';

interface RecordMenuProps {
  /** `header` = the "Record ▾" button in the page header; `fab` = the mobile floating "+" button. */
  variant: 'header' | 'fab';
  onAddCashIn: () => void;
  onAddExpense: () => void;
  onOwnerTransfer: () => void;
  onFuelTopUp: () => void;
}

/**
 * The single "Record" launcher for the Cash Ledger. Replaces the four old
 * header buttons and opens the SAME externally-controlled dialogs behind the
 * SAME permission gates. Renders nothing when the user holds none of them.
 */
export function RecordMenu({ variant, onAddCashIn, onAddExpense, onOwnerTransfer, onFuelTopUp }: RecordMenuProps) {
  const canManage = useCan(VAN_CASH_LEDGER_PERMISSIONS.manage);
  const canRemit = useCan(VAN_CASH_LEDGER_PERMISSIONS.remit);
  const canCreateExpense = useCan('expenses:create');
  const canTopUpFuelCard = useCan(FUEL_CARD_PERMISSIONS.topup);

  if (!canManage && !canRemit && !canCreateExpense && !canTopUpFuelCard) return null;

  const itemClass = 'gap-3 cursor-pointer rounded-lg px-2 py-2.5 min-h-11 sm:min-h-0';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {variant === 'fab' ? (
          <Button
            aria-label="Record a cash entry"
            className="sm:hidden fixed right-4 bottom-[4.75rem] z-40 h-12 w-12 rounded-full p-0 shadow-xl shadow-primary/30"
          >
            <Plus className="h-6 w-6" />
          </Button>
        ) : (
          <Button
            className={cn(
              'rounded-full px-5 h-11 font-bold gap-2 shadow-lg shadow-primary/20',
              'w-full sm:w-auto justify-center',
            )}
          >
            <Plus className="h-4 w-4" />
            Record
            <ChevronDown className="h-4 w-4" aria-hidden />
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72 rounded-xl p-1.5">
        <DropdownMenuLabel className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
          Record a cash entry
        </DropdownMenuLabel>
        {canManage && (
          <DropdownMenuItem onClick={onAddCashIn} className={itemClass}>
            <HandCoins className="h-4 w-4 text-teal-500 shrink-0" />
            <span className="min-w-0">
              <span className="block text-sm font-semibold">Add Cash In</span>
              <span className="block text-[11px] text-muted-foreground">Cash received into the office</span>
            </span>
          </DropdownMenuItem>
        )}
        {canCreateExpense && (
          <DropdownMenuItem onClick={onAddExpense} className={itemClass}>
            <Receipt className="h-4 w-4 text-destructive shrink-0" />
            <span className="min-w-0">
              <span className="block text-sm font-semibold">Add Expense / Crew Cash</span>
              <span className="block text-[11px] text-muted-foreground">Cash paid out for a cost</span>
            </span>
          </DropdownMenuItem>
        )}
        {canRemit && (
          <DropdownMenuItem onClick={onOwnerTransfer} className={itemClass}>
            <Landmark className="h-4 w-4 text-violet-500 shrink-0" />
            <span className="min-w-0">
              <span className="block text-sm font-semibold">Owner Transfer</span>
              <span className="block text-[11px] text-muted-foreground">Hand cash to the owner / bank (not a cost)</span>
            </span>
          </DropdownMenuItem>
        )}
        {canTopUpFuelCard && (
          <DropdownMenuItem onClick={onFuelTopUp} className={itemClass}>
            <Fuel className="h-4 w-4 text-orange-500 shrink-0" />
            <span className="min-w-0">
              <span className="block text-sm font-semibold">Fuel Card Top-up</span>
              <span className="block text-[11px] text-muted-foreground">Load cash onto a fuel card (not a cost)</span>
            </span>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
