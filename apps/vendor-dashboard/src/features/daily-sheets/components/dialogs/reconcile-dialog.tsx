'use client';

import { useState, useEffect } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button,
} from '@water-supply-crm/ui';
import { CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@water-supply-crm/ui';
import { dailySheetsApi } from '../../api/daily-sheets.api';
import { useCloseSheet } from '../../hooks/use-daily-sheets';

interface ReconcileData {
  pendingCount: number;
  bottles: { dispatched: number; delivered: number; returned: number; discrepancy: number };
  cashCustomers: { count: number; billed: number; collected: number; addedToBalance: number };
  monthlyCustomers: { count: number; billedToAccounts: number };
  driver: { shouldHandIn: number; handedIn: number; discrepancy: number };
}

interface ReconcileDialogProps {
  open: boolean;
  onClose: () => void;
  sheetId: string;
}

export function ReconcileDialog({ open, onClose, sheetId }: ReconcileDialogProps) {
  const { mutate: closeSheet, isPending: isClosing } = useCloseSheet(sheetId);
  const [data, setData] = useState<ReconcileData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) { setData(null); return; }
    setLoading(true);
    setData(null);
    dailySheetsApi.getReconciliationPreview(sheetId)
      .then((d) => setData(d as ReconcileData))
      .catch(() => { toast.error('Failed to load reconciliation preview'); onClose(); })
      .finally(() => setLoading(false));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleClose = () => { setData(null); onClose(); };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="rounded-3xl max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-primary" />
            Close &amp; Reconcile
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="py-12 flex flex-col items-center gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Loading reconciliation data...</p>
          </div>
        ) : data ? (
          <div className="space-y-4 py-4">
            {data.pendingCount > 0 && (
              <div className="flex items-start gap-2 px-4 py-3 rounded-2xl bg-destructive/10 border border-destructive/20 text-sm font-semibold text-destructive">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                {data.pendingCount} item(s) still PENDING — resolve them before closing.
              </div>
            )}

            {/* Bottle reconciliation */}
            <div className="rounded-2xl border border-border/50 bg-accent/10 overflow-hidden">
              <div className="px-4 py-2.5 bg-muted/40 border-b border-border/40">
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Bottle Summary</p>
              </div>
              <div className="p-4 grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[10px] text-muted-foreground font-bold uppercase">Dispatched</p>
                  <p className="text-xl font-black font-mono">{data.bottles.dispatched}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground font-bold uppercase">Delivered</p>
                  <p className="text-xl font-black font-mono">{data.bottles.delivered}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground font-bold uppercase">Returned to Warehouse</p>
                  <p className="text-xl font-black font-mono">{data.bottles.returned}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground font-bold uppercase">Discrepancy</p>
                  <p className={cn('text-xl font-black font-mono', data.bottles.discrepancy !== 0 ? 'text-destructive' : 'text-emerald-600')}>
                    {data.bottles.discrepancy > 0 ? '+' : ''}{data.bottles.discrepancy}
                    {data.bottles.discrepancy !== 0 && ' ⚠️'}
                  </p>
                </div>
              </div>
            </div>

            {/* Cash reconciliation */}
            <div className="rounded-2xl border border-border/50 bg-accent/10 overflow-hidden">
              <div className="px-4 py-2.5 bg-muted/40 border-b border-border/40">
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Cash Summary</p>
              </div>
              <div className="divide-y divide-border/40">
                <div className="p-4 space-y-2">
                  <p className="text-xs font-black text-foreground">Cash Customers ({data.cashCustomers.count} deliveries)</p>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-xl bg-background/70 border border-border/40 px-2 py-2">
                      <p className="text-[9px] font-bold uppercase text-muted-foreground">Billed</p>
                      <p className="text-sm font-black font-mono">₨{data.cashCustomers.billed.toLocaleString()}</p>
                    </div>
                    <div className="rounded-xl bg-background/70 border border-border/40 px-2 py-2">
                      <p className="text-[9px] font-bold uppercase text-muted-foreground">Collected</p>
                      <p className="text-sm font-black font-mono text-emerald-600">₨{data.cashCustomers.collected.toLocaleString()}</p>
                    </div>
                    <div className={cn('rounded-xl border px-2 py-2', data.cashCustomers.addedToBalance > 0 ? 'bg-amber-500/10 border-amber-500/30' : 'bg-background/70 border-border/40')}>
                      <p className="text-[9px] font-bold uppercase text-muted-foreground">→ Balance</p>
                      <p className={cn('text-sm font-black font-mono', data.cashCustomers.addedToBalance > 0 ? 'text-amber-600' : 'text-muted-foreground')}>
                        ₨{data.cashCustomers.addedToBalance.toLocaleString()}
                      </p>
                    </div>
                  </div>
                  {data.cashCustomers.addedToBalance > 0 && (
                    <p className="text-[11px] text-amber-600 font-medium">
                      ₨{data.cashCustomers.addedToBalance.toLocaleString()} added to customer balances (unpaid cash deliveries)
                    </p>
                  )}
                </div>
                {data.monthlyCustomers.count > 0 && (
                  <div className="p-4 flex items-center justify-between">
                    <div>
                      <p className="text-xs font-black">Monthly Customers ({data.monthlyCustomers.count} deliveries)</p>
                      <p className="text-[11px] text-muted-foreground">Billed to accounts — no cash expected</p>
                    </div>
                    <p className="text-sm font-black font-mono text-blue-600">₨{data.monthlyCustomers.billedToAccounts.toLocaleString()}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Driver handover */}
            <div className={cn(
              'rounded-2xl border overflow-hidden',
              data.driver.discrepancy !== 0 ? 'border-destructive/30 bg-destructive/5' : 'border-emerald-500/30 bg-emerald-500/5',
            )}>
              <div className="px-4 py-2.5 border-b border-border/40 bg-muted/40">
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Driver Handover</p>
              </div>
              <div className="p-4 grid grid-cols-3 gap-3 text-center">
                <div>
                  <p className="text-[9px] font-bold uppercase text-muted-foreground">Should Hand In</p>
                  <p className="text-lg font-black font-mono">₨{data.driver.shouldHandIn.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-[9px] font-bold uppercase text-muted-foreground">Handed In</p>
                  <p className="text-lg font-black font-mono">₨{data.driver.handedIn.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-[9px] font-bold uppercase text-muted-foreground">Difference</p>
                  <p className={cn('text-lg font-black font-mono', data.driver.discrepancy !== 0 ? 'text-destructive' : 'text-emerald-600')}>
                    {data.driver.discrepancy !== 0
                      ? `₨${Math.abs(data.driver.discrepancy).toLocaleString()} ${data.driver.discrepancy > 0 ? 'short' : 'over'} ⚠️`
                      : '✓ Clear'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="ghost" onClick={handleClose}>Cancel</Button>
          <Button
            onClick={() => closeSheet(undefined, { onSuccess: handleClose })}
            disabled={isClosing || loading || !data || data.pendingCount > 0}
            className="rounded-xl font-bold min-w-[140px]"
          >
            {isClosing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Confirm Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
