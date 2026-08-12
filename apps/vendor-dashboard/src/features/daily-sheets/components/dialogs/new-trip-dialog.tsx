'use client';

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button, Input, Label, cn,
} from '@water-supply-crm/ui';
import { Package, Loader2 } from 'lucide-react';
import { useCreateLoad } from '../../hooks/use-daily-sheets';
import { useLocationGate, type LocationGateResult } from '../../hooks/use-location-gate';
import { productsApi } from '../../../products/api/products.api';

interface NewTripDialogProps {
  open: boolean;
  onClose: () => void;
  sheetId: string;
  tripNumber: number;
  defaultFilled: number;
}

export function NewTripDialog({ open, onClose, sheetId, tripNumber, defaultFilled }: NewTripDialogProps) {
  const { mutate: createLoad, isPending } = useCreateLoad(sheetId);
  const { check: checkLocation, checking: checkingLocation } = useLocationGate();
  const [filled, setFilled] = useState(defaultFilled);
  const [productId, setProductId] = useState('');
  // null = not checked yet this dialog session; { ok:false, ... } = blocked, needs
  // either a passing retry or an explicit override before createLoad can fire.
  const [gateResult, setGateResult] = useState<LocationGateResult | null>(null);

  const { data: productsData } = useQuery({
    queryKey: ['new-trip-products'],
    queryFn: () => productsApi.getAll({ page: 1, limit: 100, isActive: true }).then((r) => r.data),
  });

  const products: { id: string; name: string }[] =
    (productsData as any)?.data ?? (productsData as any)?.items ?? [];

  useEffect(() => {
    if (open) {
      setFilled(defaultFilled);
      setProductId(products[0]?.id ?? '');
      setGateResult(null);
    }
  }, [open, defaultFilled]); // eslint-disable-line react-hooks/exhaustive-deps

  const dispatch = () => {
    createLoad(
      { loadedFilled: filled, ...(productId ? { productId } : {}) },
      { onSuccess: onClose },
    );
  };

  // Confirm Dispatch always runs the GPS gate first — a pass clears any prior
  // blocker and starts the trip in the same click; a failure just shows the
  // blocker card (dispatch never fires) so the driver knows exactly why.
  const handleConfirm = async () => {
    const result = await checkLocation();
    setGateResult(result);
    if (result.ok) dispatch();
  };

  const gateBlocked = gateResult !== null && !gateResult.ok;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="rounded-3xl max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <Package className="h-5 w-5 text-primary" />
            Start Load-Out
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          {products.length > 1 && (
            <div className="space-y-2">
              <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">Product</Label>
              <select
                value={productId}
                onChange={(e) => setProductId(e.target.value)}
                className="w-full h-10 rounded-xl bg-background/50 border border-border/50 text-sm text-foreground dark:text-white px-3 outline-none focus:ring-2 focus:ring-primary/30"
              >
                {products.map((p) => (
                  <option key={p.id} value={p.id} className="bg-background text-foreground dark:text-white">
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="space-y-2">
            <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
              Trip {tripNumber} — Filled Bottles Dispatched
            </Label>
            <Input
              type="number"
              min={1}
              value={filled}
              onChange={(e) => setFilled(Number(e.target.value))}
              className="h-14 text-3xl font-black font-mono text-center"
            />
            <p className="text-[11px] text-muted-foreground">Total filled bottles loaded into the van for this trip.</p>
          </div>

          {/* GPS gate blocker — trip cannot start invisibly to the dispatch map.
              docs: dashboard/tracking location-permission fix. */}
          {gateBlocked && (
            <div className={cn(
              'rounded-xl border px-4 py-3 flex items-start gap-3 text-sm',
              gateResult.reason === 'DENIED'
                ? 'border-red-500/40 bg-red-500/10'
                : 'border-amber-500/40 bg-amber-500/10',
            )}>
              <span className="text-lg leading-none mt-0.5">
                {gateResult.reason === 'DENIED' ? '🚫' : '📡'}
              </span>
              <div className="space-y-1.5 min-w-0">
                <p className={cn(
                  'font-bold text-xs uppercase tracking-widest',
                  gateResult.reason === 'DENIED' ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400',
                )}>
                  {gateResult.reason === 'DENIED' && 'Location access is blocked'}
                  {gateResult.reason === 'UNAVAILABLE' && 'GPS signal not found'}
                  {gateResult.reason === 'UNSUPPORTED' && 'Location not supported'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {gateResult.reason === 'DENIED' &&
                    'Enable location for this app in your phone/browser settings, then refresh this page and try again. Dispatch needs this to see your trip on the live map.'}
                  {gateResult.reason === 'UNAVAILABLE' &&
                    'Move to an open area with a clear sky view and try again.'}
                  {gateResult.reason === 'UNSUPPORTED' &&
                    'This browser does not support location — your trip cannot be shown on the live map.'}
                </p>
                <div className="flex items-center gap-2 pt-0.5">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 rounded-lg text-xs font-bold"
                    onClick={handleConfirm}
                    disabled={checkingLocation}
                  >
                    {checkingLocation ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                    Try Again
                  </Button>
                  {/* No override for DENIED — that's the exact case this gate exists to
                      stop. UNAVAILABLE/UNSUPPORTED are environment/hardware limits, not
                      a driver choice, so those get an explicit escape hatch. */}
                  {gateResult.reason !== 'DENIED' && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 rounded-lg text-xs font-bold text-muted-foreground"
                      onClick={dispatch}
                      disabled={isPending}
                    >
                      Start anyway
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            onClick={handleConfirm}
            disabled={isPending || checkingLocation || filled < 1}
            className="rounded-xl font-bold"
          >
            {(isPending || checkingLocation) ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            {checkingLocation ? 'Checking location…' : 'Confirm Dispatch'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
