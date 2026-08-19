'use client';

import { Accordion, AccordionItem, AccordionTrigger, AccordionContent, Badge } from '@water-supply-crm/ui';
import { Wallet } from 'lucide-react';
import { SheetExpensesSection } from './sheet-expenses-section';
import { SheetCrewCashSection } from './sheet-crew-cash-section';
import { useCrewCashForSheet } from '../../crew-cash/hooks/use-crew-cash';
import type { CrewCashEmployeeOption } from '../../crew-cash/components/crew-cash-form';
import type { SheetExpense } from '@water-supply-crm/types';

interface SheetCashOutSectionProps {
  sheetId: string;
  date: string;
  expenses: SheetExpense[];
  crewMembers: CrewCashEmployeeOption[];
  isClosed: boolean;
  canDeleteExpense: boolean;
  canUpdateExpense: boolean;
  currentUserId?: string;
  canEditAllCrewCash: boolean;
  canDeleteAllCrewCash: boolean;
}

/**
 * Trip Expenses and Crew Cash Distribution are two different record types —
 * different forms, different edit/delete permissions — but the same idea to
 * whoever's reviewing the sheet: "cash that left the van today". Folding
 * both under one collapsed-by-default accordion gives that unified view
 * without merging their distinct logic: each keeps rendering as its own
 * existing section (unchanged) once expanded. Collapsed, the combined total
 * is visible at a glance and the whole block costs one row of height no
 * matter how many entries exist, instead of two full section stacks sitting
 * between the trip header and the actual customer list below.
 */
export function SheetCashOutSection({
  sheetId,
  date,
  expenses,
  crewMembers,
  isClosed,
  canDeleteExpense,
  canUpdateExpense,
  currentUserId,
  canEditAllCrewCash,
  canDeleteAllCrewCash,
}: SheetCashOutSectionProps) {
  // Same query key SheetCrewCashSection uses below — react-query dedupes
  // this into a single network request, not two.
  const { data: crewCashEntries } = useCrewCashForSheet(sheetId);
  const crewCashList = crewCashEntries ?? [];

  const expenseTotal = expenses.reduce((s, e) => s + e.amount, 0);
  const crewCashTotal = crewCashList.reduce((s, e) => s + e.amount, 0);
  const combinedTotal = expenseTotal + crewCashTotal;
  const entryCount = expenses.length + crewCashList.length;
  const pendingApprovalCount = crewCashList.filter((e) => e.requiresApproval && !e.approvedAt).length;

  return (
    <Accordion type="single" collapsible className="rounded-2xl border border-border/40 bg-card/30 px-4">
      <AccordionItem value="cash-out" className="border-none">
        <AccordionTrigger className="hover:no-underline py-3">
          <div className="flex items-center justify-between flex-1 pr-3 gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-8 w-8 rounded-lg bg-destructive/10 flex items-center justify-center text-destructive shrink-0">
                <Wallet className="h-4 w-4" />
              </div>
              <div className="text-left min-w-0">
                <p className="text-sm font-black uppercase tracking-widest text-muted-foreground">Cash Out</p>
                <p className="text-[11px] text-muted-foreground truncate">
                  {entryCount === 0
                    ? 'No expenses or crew cash recorded'
                    : `${expenses.length} expense${expenses.length === 1 ? '' : 's'} · ${crewCashList.length} crew cash`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {pendingApprovalCount > 0 && (
                <Badge className="text-[10px] font-bold px-2 py-0.5 rounded-full border-none bg-amber-500/10 text-amber-600">
                  {pendingApprovalCount} pending
                </Badge>
              )}
              <p className="font-mono font-black text-sm text-destructive whitespace-nowrap">
                ₨ {combinedTotal.toLocaleString()}
              </p>
            </div>
          </div>
        </AccordionTrigger>
        <AccordionContent className="space-y-5 pt-1 pb-4">
          <SheetExpensesSection
            sheetId={sheetId}
            date={date}
            expenses={expenses}
            isClosed={isClosed}
            canDelete={canDeleteExpense}
            canUpdate={canUpdateExpense}
          />
          <SheetCrewCashSection
            sheetId={sheetId}
            crewMembers={crewMembers}
            isClosed={isClosed}
            currentUserId={currentUserId}
            canEditAll={canEditAllCrewCash}
            canDeleteAll={canDeleteAllCrewCash}
          />
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
