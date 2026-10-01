'use client';

import { useState } from 'react';
import { Button, Card, CardContent, Badge } from '@water-supply-crm/ui';
import { HandCoins, Lock, Pencil, Plus, Trash2 } from 'lucide-react';
import type { SheetAdvanceEntry } from '@water-supply-crm/types';
import type { CrewCashEmployeeOption } from '../../crew-cash/components/employee-select';
import { AdvanceFormDialog } from '../../sheet-advances/components/advance-form-dialog';
import { DeleteAdvanceDialog } from '../../sheet-advances/components/delete-advance-dialog';

interface SheetAdvancesSectionProps {
  sheetId: string;
  advances: SheetAdvanceEntry[];
  /** This sheet's driver + crew — listed first in the form's employee dropdown. */
  crewMembers: CrewCashEmployeeOption[];
  isClosed: boolean;
  currentUserId?: string;
  /** `payroll:ledger_create` (+ the closed-sheet permission when the sheet is closed). */
  canAdd: boolean;
  /** `payroll:ledger_void` — may change an advance somebody else recorded (the creator may always change their own). */
  canManageAny: boolean;
  /** `daily_sheets:edit_closed_expense` — required on top of the above to change anything on a CLOSED sheet. */
  canEditClosed: boolean;
}

/**
 * Salary advances handed to employees out of the van's cash (owner request 2026-10-01). Same
 * "cash that left the van" idea as Expenses / Crew Cash — each row is deducted from the day's cash
 * hand-in — but each also lands on the employee's payroll ledger as an Advance. Works on open and
 * closed sheets; on a closed sheet every change needs a reason (collected by the dialogs).
 */
export function SheetAdvancesSection({
  sheetId,
  advances,
  crewMembers,
  isClosed,
  currentUserId,
  canAdd,
  canManageAny,
  canEditClosed,
}: SheetAdvancesSectionProps) {
  const [formOpen, setFormOpen] = useState(false);
  const [editEntry, setEditEntry] = useState<SheetAdvanceEntry | null>(null);
  const [deleteEntry, setDeleteEntry] = useState<SheetAdvanceEntry | null>(null);

  const total = advances.reduce((s, a) => s + a.amount, 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-black uppercase tracking-widest text-muted-foreground">Advances</h3>
        {canAdd && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1 text-xs"
            onClick={() => { setEditEntry(null); setFormOpen(true); }}
          >
            <Plus className="h-3.5 w-3.5" />
            Add
          </Button>
        )}
      </div>

      {advances.length === 0 ? (
        <Card className="bg-card/30 border-border/40">
          <CardContent className="p-4 text-center text-xs text-muted-foreground">
            No advances given from this sheet&apos;s cash.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {advances.map((advance) => {
            const ledgerStatus = advance.staffLedgerEntry?.status;
            const lockedInPayroll = !!advance.staffLedgerEntry?.payrollEntryId;
            const isPendingApproval = ledgerStatus === 'PENDING';
            const canManage =
              (advance.createdById === currentUserId || canManageAny) && (!isClosed || canEditClosed);

            return (
              <Card key={advance.id} className="bg-card/50 border-border/40">
                <CardContent className="p-3 flex items-center gap-3">
                  <div className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0 bg-emerald-500/10 text-emerald-600">
                    <HandCoins className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge className="text-[10px] font-bold px-2 py-0.5 rounded-full border-none bg-emerald-500/10 text-emerald-600">
                        Advance
                      </Badge>
                      <Badge variant="secondary" className="text-[10px] font-semibold">{advance.employee.name}</Badge>
                      {isPendingApproval && (
                        <Badge
                          className="text-[10px] font-bold px-2 py-0.5 rounded-full border-none bg-amber-500/10 text-amber-600"
                          title="Awaiting approval on the Payroll page. The cash has already left the van and is deducted from the hand-in."
                        >
                          Pending Approval
                        </Badge>
                      )}
                      {lockedInPayroll && (
                        <Badge
                          className="text-[10px] font-bold px-2 py-0.5 rounded-full border-none bg-muted text-muted-foreground gap-1"
                          title="Already used in a locked payroll period — it can no longer be edited, only deleted (reversed in the current period)."
                        >
                          <Lock className="h-2.5 w-2.5" />
                          In payroll
                        </Badge>
                      )}
                    </div>
                    {advance.notes && <p className="text-xs text-muted-foreground truncate mt-0.5">{advance.notes}</p>}
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Recorded by <span className="font-medium text-foreground">{advance.createdBy?.name ?? '—'}</span>
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-mono font-black text-sm text-destructive">₨ {Number(advance.amount).toLocaleString()}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {new Date(advance.date).toLocaleDateString('en-PK', { day: 'numeric', month: 'short' })}
                    </p>
                  </div>
                  {canManage && !lockedInPayroll && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-orange-500 shrink-0"
                      onClick={() => { setEditEntry(advance); setFormOpen(true); }}
                      aria-label="Edit advance"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  {canManage && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
                      onClick={() => setDeleteEntry(advance)}
                      aria-label="Delete advance"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}

          <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-destructive/5 border border-destructive/20">
            <p className="text-xs font-bold text-destructive uppercase tracking-widest">Advances Deducted from Cash Hand-In</p>
            <p className="font-mono font-black text-sm text-destructive">₨ {total.toLocaleString()}</p>
          </div>
        </div>
      )}

      <AdvanceFormDialog
        open={formOpen}
        onOpenChange={(o) => { setFormOpen(o); if (!o) setEditEntry(null); }}
        sheetId={sheetId}
        crew={crewMembers}
        entry={editEntry}
        isClosed={isClosed}
      />

      <DeleteAdvanceDialog
        open={!!deleteEntry}
        onClose={() => setDeleteEntry(null)}
        sheetId={sheetId}
        entry={deleteEntry}
        isClosed={isClosed}
      />
    </div>
  );
}
