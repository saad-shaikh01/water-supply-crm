'use client';

import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, Button,
} from '@water-supply-crm/ui';
import { CheckCircle2, Loader2, Pencil, ShieldCheck, Users } from 'lucide-react';
import type { SheetCrewMember } from '@water-supply-crm/types';
import { useConfirmCrew } from '../../hooks/use-daily-sheets';

interface CrewConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  sheetId: string;
  driverName: string | null;
  crew: SheetCrewMember[];
  /** Closes this dialog and opens the crew editor. */
  onEditCrew: () => void;
}

/**
 * Mandatory pre-trip check: shown when a sheet's crew is unconfirmed.
 * Normal day = one click on "Confirm Crew"; exceptions go through "Edit Crew".
 */
export function CrewConfirmDialog({
  open, onClose, sheetId, driverName, crew, onEditCrew,
}: CrewConfirmDialogProps) {
  const { mutate: confirmCrew, isPending } = useConfirmCrew(sheetId);

  const salesman = crew.find((c) => c.role === 'SALESMAN');
  const loaders = crew.filter((c) => c.role === 'LOADER');

  const row = (label: string, names: string[], missingLabel: string) => (
    <div className="flex items-start justify-between gap-3 px-4 py-3">
      <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mt-0.5">
        {label}
      </span>
      <div className="text-right">
        {names.length > 0 ? (
          names.map((n) => (
            <p key={n} className="text-sm font-bold">{n}</p>
          ))
        ) : (
          <p className="text-sm text-muted-foreground italic">{missingLabel}</p>
        )}
      </div>
    </div>
  );

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
          </p>

          <div className="rounded-2xl border border-border/50 bg-accent/20 divide-y divide-border/40">
            {row('Driver', driverName ? [driverName] : [], 'No driver')}
            {row('Salesman', salesman ? [salesman.user.name] : [], 'No salesman')}
            {row(
              loaders.length > 1 ? 'Loaders' : 'Loader',
              loaders.map((l) => l.user.name),
              'No loaders',
            )}
          </div>

          {crew.length === 0 && (
            <div className="flex items-start gap-2 text-[11px] text-amber-600 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2">
              <Users className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              No supporting crew is assigned. You can confirm with the driver only, or edit the
              crew to add a salesman/loaders. Set a default crew on the van to fill this automatically.
            </div>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-col gap-2">
          <Button
            onClick={() => confirmCrew(undefined, { onSuccess: onClose })}
            disabled={isPending}
            className="w-full rounded-xl font-bold gap-2"
          >
            {isPending
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <CheckCircle2 className="h-4 w-4" />}
            Confirm Crew
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
