'use client';

import { useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@water-supply-crm/ui';
import { ArrowRightLeft, Loader2, User, Truck } from 'lucide-react';
import { useSwapAssignment } from '../../hooks/use-daily-sheets';
import { useAllVans } from '../../../vans/hooks/use-vans';
import { useAllDrivers } from '../../../users/hooks/use-users';

interface SwapDialogProps {
  open: boolean;
  onClose: () => void;
  sheetId: string;
  currentDriverId?: string | null;
  currentDriverName?: string | null;
  currentVanId?: string | null;
  currentVanPlate?: string | null;
}

export function SwapDialog({
  open, onClose, sheetId,
  currentDriverId, currentDriverName, currentVanId, currentVanPlate,
}: SwapDialogProps) {
  const { mutate: swapAssignment, isPending } = useSwapAssignment(sheetId);
  const { data: vansData } = useAllVans();
  const { data: driversData } = useAllDrivers();
  const allVans = vansData?.data ?? [];
  const allDrivers = driversData?.data ?? [];

  const [form, setForm] = useState<{ vanId?: string; driverId?: string }>({});

  const handleClose = () => {
    setForm({});
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="rounded-3xl max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <ArrowRightLeft className="h-5 w-5 text-primary" />
            Swap Assignment
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-4">
          {/* Driver section */}
          <div className="space-y-3 p-4 rounded-2xl bg-accent/20 border border-border/30">
            <div className="flex items-center justify-between">
              <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">Driver</Label>
              <span className="text-[10px] text-muted-foreground">This sheet only</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <User className="h-3.5 w-3.5" />
              <span>Current: <span className="font-bold text-foreground">{currentDriverName ?? '—'}</span></span>
            </div>
            <Select
              value={form.driverId ?? ''}
              onValueChange={(v) => setForm((p) => ({ ...p, driverId: v || undefined }))}
            >
              <SelectTrigger className="h-10">
                <SelectValue placeholder="Keep current driver" />
              </SelectTrigger>
              <SelectContent>
                {allDrivers
                  .filter((d) => d.id !== currentDriverId)
                  .map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
              </SelectContent>
            </Select>
            {form.driverId && (
              <button
                className="text-[11px] text-muted-foreground underline"
                onClick={() => setForm((p) => ({ ...p, driverId: undefined }))}
              >
                Clear driver change
              </button>
            )}
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
            These changes apply to this sheet only. To permanently change a van&apos;s default driver, update the van in Settings.
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={handleClose}>Cancel</Button>
          <Button
            onClick={() => swapAssignment(form, { onSuccess: handleClose })}
            disabled={isPending || (!form.vanId && !form.driverId)}
            className="rounded-xl font-bold"
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Confirm Swap
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
