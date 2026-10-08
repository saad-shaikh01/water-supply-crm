'use client';

import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@water-supply-crm/ui';
import { ArrowRightLeft, Loader2, Truck } from 'lucide-react';
import type { SheetCrewMember } from '@water-supply-crm/types';
import { useSwapAssignment } from '../../hooks/use-daily-sheets';
import { useAllVans } from '../../../vans/hooks/use-vans';
import { useCrewCandidates } from '../../../users/hooks/use-users';
import {
  CrewEditor, crewArrayToSelection, crewSelectionToArray, emptyCrewSelection,
  CREW_ROLE_ELIGIBLE, type CrewSelection,
} from '../../../../components/shared/crew-editor';

interface SwapDialogProps {
  open: boolean;
  onClose: () => void;
  sheetId: string;
  currentDriverId?: string | null;
  currentDriverName?: string | null;
  /** The sheet's salesman (DailySheet.salesmanId) — seeds the "separate salesman" slot when it differs from the driver. */
  currentSalesmanId?: string | null;
  currentVanId?: string | null;
  currentVanPlate?: string | null;
  currentCrew?: SheetCrewMember[];
  /** Called after a successful save (e.g. to reopen the crew confirmation). */
  onSaved?: () => void;
}

export function SwapDialog({
  open, onClose, sheetId,
  currentDriverId, currentSalesmanId, currentVanId, currentVanPlate,
  currentCrew, onSaved,
}: SwapDialogProps) {
  const { mutate: swapAssignment, isPending } = useSwapAssignment(sheetId);
  const { data: vansData } = useAllVans();
  const { data: candidatesData } = useCrewCandidates();
  const allVans = vansData?.data ?? [];

  const [form, setForm] = useState<{ vanId?: string; driverId?: string }>({});
  const [crew, setCrew] = useState<CrewSelection>(emptyCrewSelection);

  // The salesman is the sheet's primary person; the driver is picked independently
  // (and may be the same person).
  const [salesmanId, setSalesmanId] = useState<string | null>(null);

  const users = (candidatesData?.data ?? []) as Array<{ id: string; name: string; role: string }>;
  const loaderIds = new Set(crew.loaderIds);
  const salesmanOptions = users.filter(
    (u) => CREW_ROLE_ELIGIBLE.SALESMAN.includes(u.role) && !loaderIds.has(u.id),
  );
  // Any eligible field staff except the loaders (backend rejects a driver doubling
  // as a loader). The salesman may also drive.
  const driverOptions = users.filter(
    (u) => CREW_ROLE_ELIGIBLE.DRIVER.includes(u.role) && !loaderIds.has(u.id),
  );
  // The driver is REQUIRED and never pre-selected — not the sheet's current driver,
  // not the salesman. Staff must pick one explicitly on every save (the salesman may
  // also be picked); Save stays disabled until they do.
  const selectedDriverId = form.driverId ?? null;

  // Seed from the sheet each time the dialog opens. The salesman always comes
  // from the sheet's salesmanId (DailySheet.crew holds loaders only).
  useEffect(() => {
    if (!open) return;
    const seeded = crewArrayToSelection(currentCrew);
    seeded.salesmanIds = [];
    setCrew(seeded);
    const sm = currentSalesmanId ?? currentDriverId ?? null;
    setSalesmanId(sm);
    setForm({});
  }, [open, currentCrew, currentSalesmanId, currentDriverId]);

  const handleClose = () => {
    setForm({});
    onClose();
  };

  const handleSave = () => {
    const effectiveDriverId = selectedDriverId;
    // Send the driver when it changes, or when the van changes (the backend would
    // otherwise auto-assign the new van's default driver over our choice).
    const sendDriver = !!effectiveDriverId && (effectiveDriverId !== currentDriverId || !!form.vanId);
    const crewPayload = [
      ...(salesmanId ? [{ userId: salesmanId, role: 'SALESMAN' as const }] : []),
      ...crewSelectionToArray({ salesmanIds: [], loaderIds: crew.loaderIds }),
    ];
    swapAssignment(
      {
        ...(form.vanId ? { vanId: form.vanId } : {}),
        ...(sendDriver ? { driverId: effectiveDriverId as string } : {}),
        crew: crewPayload,
      },
      {
        onSuccess: () => {
          handleClose();
          onSaved?.();
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="rounded-3xl max-w-sm max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <ArrowRightLeft className="h-5 w-5 text-primary" />
            Edit Crew &amp; Assignment
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-4">
          {/* Salesman section */}
          <div className="space-y-3 p-4 rounded-2xl bg-accent/20 border border-border/30">
            <div className="flex items-center justify-between">
              <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">Salesman</Label>
              <span className="text-[10px] text-muted-foreground">This sheet only</span>
            </div>
            <Select value={salesmanId ?? ''} onValueChange={(v) => setSalesmanId(v || null)}>
              <SelectTrigger className="h-10">
                <SelectValue placeholder="Select salesman" />
              </SelectTrigger>
              <SelectContent>
                {salesmanOptions.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name}
                    {u.role !== 'SALESMAN' && (
                      <span className="ml-1 text-xs text-muted-foreground">({u.role.toLowerCase()})</span>
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Driver section */}
          <div className="space-y-3 p-4 rounded-2xl bg-accent/20 border border-border/30">
            <div className="flex items-center justify-between">
              <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">Driver</Label>
              <span className="text-[10px] text-muted-foreground">This sheet only</span>
            </div>
            <Select
              value={selectedDriverId ?? ''}
              onValueChange={(v) => setForm((p) => ({ ...p, driverId: v || undefined }))}
            >
              <SelectTrigger className="h-10">
                <SelectValue placeholder="Select driver (required)" />
              </SelectTrigger>
              <SelectContent>
                {driverOptions.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                    {d.role !== 'DRIVER' && (
                      <span className="ml-1 text-xs text-muted-foreground">({d.role.toLowerCase()})</span>
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Loaders section */}
          <div className="space-y-3 p-4 rounded-2xl bg-accent/20 border border-border/30">
            <CrewEditor
              value={crew}
              onChange={setCrew}
              excludeUserId={[salesmanId, selectedDriverId]}
              hideSalesman
            />
          </div>

          {/* Van section */}
          <div className="space-y-3 p-4 rounded-2xl bg-accent/20 border border-border/30">
            <div className="flex items-center justify-between">
              <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">Van</Label>
              <span className="text-[10px] text-muted-foreground">This sheet only</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Truck className="h-3.5 w-3.5" />
              <span>Current: <span className="font-bold text-foreground">{currentVanPlate ?? '—'}</span></span>
            </div>
            <Select
              value={form.vanId ?? ''}
              onValueChange={(v) => setForm((p) => ({ ...p, vanId: v || undefined }))}
            >
              <SelectTrigger className="h-10">
                <SelectValue placeholder="Keep current van" />
              </SelectTrigger>
              <SelectContent>
                {allVans
                  .filter((v) => v.id !== currentVanId)
                  .map((v) => (
                    <SelectItem key={v.id} value={v.id}>{v.plateNumber}</SelectItem>
                  ))}
              </SelectContent>
            </Select>
            {form.vanId && (
              <button
                className="text-[11px] text-muted-foreground underline"
                onClick={() => setForm((p) => ({ ...p, vanId: undefined }))}
              >
                Clear van change
              </button>
            )}
          </div>

          <p className="text-[11px] text-muted-foreground bg-muted/40 rounded-xl px-3 py-2">
            These changes apply to this sheet only and reset the crew confirmation — the updated
            crew must be confirmed again before a trip can start. To change a van&apos;s defaults,
            update the van in Settings.
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={handleClose}>Cancel</Button>
          <Button
            onClick={handleSave}
            disabled={isPending || !salesmanId || !selectedDriverId}
            className="rounded-xl font-bold"
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
