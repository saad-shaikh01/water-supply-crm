'use client';

import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, Button,
} from '@water-supply-crm/ui';
import { cn } from '@water-supply-crm/ui';
import { CheckCircle2, Loader2, Pencil, ShieldCheck, Users } from 'lucide-react';
import type { SheetCrewMember } from '@water-supply-crm/types';
import { useConfirmCrew } from '../../hooks/use-daily-sheets';

interface CrewConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  sheetId: string;
  driverId: string | null;
  driverName: string | null;
  crew: SheetCrewMember[];
  /** Closes this dialog and opens the crew editor. */
  onEditCrew: () => void;
}

/** One toggleable roster line. `userId: null` = a synthetic line (e.g. driver doubling as salesman) — not toggleable. */
interface RosterLine {
  key: string;
  name: string;
  userId: string | null;
}

/**
 * Mandatory pre-trip check: shown when a sheet's crew is unconfirmed.
 * Normal day = one click on "Confirm Crew"; exceptions go through "Edit Crew".
 *
 * Staff Attendance Phase 2: each roster line can be flipped to "Absent" before
 * confirming. Absences are sent as `absentUserIds` on the same one-click POST —
 * nobody toggled ⇒ the request is byte-identical to before. Marking absent here
 * is operational only (no deduction amount); the payroll deduction is a separate
 * step on the Attendance screen.
 */
export function CrewConfirmDialog({
  open, onClose, sheetId, driverId, driverName, crew, onEditCrew,
}: CrewConfirmDialogProps) {
  const { mutate: confirmCrew, isPending } = useConfirmCrew(sheetId);

  const [absentUserIds, setAbsentUserIds] = useState<string[]>([]);
  useEffect(() => {
    if (open) setAbsentUserIds([]);
  }, [open]);

  const toggleAbsent = (userId: string) =>
    setAbsentUserIds((cur) => (cur.includes(userId) ? cur.filter((id) => id !== userId) : [...cur, userId]));

  const salesmen = crew.filter((c) => c.role === 'SALESMAN');
  const loaders = crew.filter((c) => c.role === 'LOADER');

  const driverLines: RosterLine[] = driverName
    ? [{ key: driverId ?? 'driver', name: driverName, userId: driverId }]
    : [];
  const salesmanLines: RosterLine[] =
    salesmen.length > 0
      ? salesmen.map((s) => ({ key: s.userId, name: s.user.name, userId: s.userId }))
      : driverName
        ? [{ key: 'driver-as-salesman', name: `${driverName} (same as driver)`, userId: null }]
        : [];
  const loaderLines: RosterLine[] = loaders.map((l) => ({ key: l.userId, name: l.user.name, userId: l.userId }));

  const row = (label: string, lines: RosterLine[], missingLabel: string) => (
    <div className="flex items-start justify-between gap-3 px-4 py-3">
      <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mt-1">
        {label}
      </span>
      <div className="flex-1 space-y-1.5">
        {lines.length > 0 ? (
          lines.map((line) => {
            const isAbsent = !!line.userId && absentUserIds.includes(line.userId);
            return (
              <div key={line.key} className="flex items-center justify-end gap-2">
                <span className={cn('text-sm font-bold', isAbsent && 'line-through text-muted-foreground')}>
                  {line.name}
                </span>
                {line.userId ? (
                  <button
                    type="button"
                    onClick={() => toggleAbsent(line.userId as string)}
                    disabled={isPending}
                    className={cn(
                      'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide transition',
                      isAbsent
                        ? 'bg-red-500/15 text-red-600 dark:text-red-400'
                        : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20',
                    )}
                  >
                    {isAbsent ? 'Absent' : 'Present'}
                  </button>
                ) : null}
              </div>
            );
          })
        ) : (
          <p className="text-right text-sm text-muted-foreground italic">{missingLabel}</p>
        )}
      </div>
    </div>
  );

  const absentCount = absentUserIds.length;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="rounded-3xl max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            Confirm Today&apos;s Crew
          </DialogTitle>
        </DialogHeader>

        <div className="py-2 space-y-4">
          <p className="text-xs text-muted-foreground">
            Verify who is going out on this van today. Trips cannot start until the crew is confirmed.
            Tap a name to mark it absent.
          </p>

          <div className="rounded-2xl border border-border/50 bg-accent/20 divide-y divide-border/40">
            {row('Driver', driverLines, 'No driver')}
            {row(salesmen.length > 1 ? 'Salesmen' : 'Salesman', salesmanLines, 'No salesman')}
            {row(loaders.length > 1 ? 'Loaders' : 'Loader', loaderLines, 'No loaders')}
          </div>

          {crew.length === 0 && (
            <div className="flex items-start gap-2 text-[11px] text-amber-600 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2">
              <Users className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              No separate salesman or loaders are assigned — the driver is treated as the salesman.
              You can confirm as-is, or edit the crew to add a separate salesman/loaders. Set a
              default crew on the van to fill this automatically.
            </div>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-col gap-2">
          <Button
            onClick={() =>
              confirmCrew(absentCount > 0 ? { absentUserIds } : undefined, { onSuccess: onClose })
            }
            disabled={isPending}
            className="w-full rounded-xl font-bold gap-2"
          >
            {isPending
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <CheckCircle2 className="h-4 w-4" />}
            Confirm Crew{absentCount > 0 ? ` (${absentCount} absent)` : ''}
          </Button>
          <Button
            variant="outline"
            onClick={onEditCrew}
            disabled={isPending}
            className="w-full rounded-xl font-bold gap-2"
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit Crew
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
