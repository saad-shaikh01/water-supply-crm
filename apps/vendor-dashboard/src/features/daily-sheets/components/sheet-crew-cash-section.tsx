'use client';

import { useState } from 'react';
import { Button, Card, CardContent, Badge, Skeleton } from '@water-supply-crm/ui';
import { Pencil, Trash2 } from 'lucide-react';
import { cn } from '@water-supply-crm/ui';
import { ConfirmDialog } from '../../../components/shared/confirm-dialog';
import { CrewCashForm, type CrewCashEmployeeOption } from '../../crew-cash/components/crew-cash-form';
import { useCrewCashForSheet, useDeleteCrewCash } from '../../crew-cash/hooks/use-crew-cash';
import { CREW_CASH_CATEGORY_CONFIG } from '../../crew-cash/constants';
import type { CrewCashEntry } from '@water-supply-crm/types';

interface SheetCrewCashSectionProps {
  sheetId: string;
  /** Today's confirmed crew (driver + DailySheetCrew) — used both as the Add dialog's
   * employee picker and to resolve `employeeId` to a display name in the list below,
   * since `listForSheet` returns raw rows with no relations joined. */
  crewMembers: CrewCashEmployeeOption[];
  isClosed: boolean;
  currentUserId?: string;
  /** `crew_cash:edit` / `crew_cash:delete` — the entry's own creator may also always edit/delete their own row (backend-enforced; mirrored here for the affordance). */
  canEditAll: boolean;
  canDeleteAll: boolean;
}

export function SheetCrewCashSection({
  sheetId,
  crewMembers,
  isClosed,
  currentUserId,
  canEditAll,
  canDeleteAll,
}: SheetCrewCashSectionProps) {
  const { data: entries, isLoading, isError } = useCrewCashForSheet(sheetId);
  const { mutate: deleteEntry, isPending: isDeleting } = useDeleteCrewCash(sheetId);
  const [formOpen, setFormOpen] = useState(false);
  const [editEntry, setEditEntry] = useState<CrewCashEntry | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const list = entries ?? [];
  const employeeName = (employeeId: string) =>
    crewMembers.find((m) => m.id === employeeId)?.name ?? 'Unknown';

  const openEdit = (entry: CrewCashEntry) => { setEditEntry(entry); setFormOpen(true); };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-black uppercase tracking-widest text-muted-foreground">Crew Cash Distribution</h3>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full rounded-2xl" />
          <Skeleton className="h-16 w-full rounded-2xl" />
        </div>
      ) : isError ? (
        <Card className="bg-destructive/5 border-destructive/20">
          <CardContent className="p-4 text-center text-xs text-destructive">
            Failed to load Crew Cash Distribution entries.
          </CardContent>
        </Card>
      ) : list.length === 0 ? (
        <Card className="bg-card/30 border-border/40">
          <CardContent className="p-4 text-center text-xs text-muted-foreground">
            No crew cash recorded for this trip.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {list.map((entry) => {
            const cfg = CREW_CASH_CATEGORY_CONFIG[entry.category] ?? CREW_CASH_CATEGORY_CONFIG.OTHER;
            const Icon = cfg.icon;
            const isPendingApproval = entry.requiresApproval && !entry.approvedAt;
            const canEditRow = !isClosed && (canEditAll || entry.createdById === currentUserId);
            const canDeleteRow = !isClosed && (canDeleteAll || entry.createdById === currentUserId);

            return (
              <Card
                key={entry.id}
                className={cn('bg-card/50 border-border/40', canEditRow && 'cursor-pointer hover:bg-card/70 transition-colors')}
                onClick={canEditRow ? () => openEdit(entry) : undefined}
              >
                <CardContent className="p-3 flex items-center gap-3">
                  <div className={cn('h-8 w-8 rounded-lg flex items-center justify-center shrink-0', cfg.color)}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full border-none', cfg.color)}>
                        {cfg.label}
                      </Badge>
                      <Badge variant="secondary" className="text-[10px] font-semibold">
                        {employeeName(entry.employeeId)}
                      </Badge>
                      {isPendingApproval && (
                        <Badge className="text-[10px] font-bold px-2 py-0.5 rounded-full border-none bg-amber-500/10 text-amber-600">
                          Pending Approval
                        </Badge>
                      )}
                      {canEditRow && <Pencil className="h-3 w-3 text-muted-foreground/60 shrink-0" />}
                    </div>
                    {entry.notes && (
                      <p className="text-xs text-muted-foreground truncate mt-0.5">{entry.notes}</p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-mono font-black text-sm text-destructive">
                      ₨ {Number(entry.amount).toLocaleString()}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {new Date(entry.date).toLocaleDateString('en-PK', { day: 'numeric', month: 'short' })}
                    </p>
                  </div>
                  {canDeleteRow && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
                      onClick={(e) => { e.stopPropagation(); setDeleteId(entry.id); }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}

          {/* Total footer */}
          <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-destructive/5 border border-destructive/20">
            <p className="text-xs font-bold text-destructive uppercase tracking-widest">Total Crew Cash</p>
            <p className="font-mono font-black text-sm text-destructive">
              ₨ {list.reduce((s, e) => s + e.amount, 0).toLocaleString()}
            </p>
          </div>
        </div>
      )}

      <CrewCashForm
        open={formOpen}
        onOpenChange={(o) => { setFormOpen(o); if (!o) setEditEntry(null); }}
        sheetId={sheetId}
        employees={crewMembers}
        entry={editEntry}
      />

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(o) => { if (!o) setDeleteId(null); }}
        title="Delete Crew Cash Entry"
        description="Are you sure? This action cannot be undone."
        onConfirm={() => {
          if (deleteId) deleteEntry(deleteId, { onSuccess: () => setDeleteId(null) });
        }}
        isLoading={isDeleting}
        confirmLabel="Delete"
      />
    </div>
  );
}
