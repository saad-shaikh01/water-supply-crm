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
  expenses: { total: number };
  driver: {
    shouldHandIn: number;
    expensePaidFromCash: number;
    netToHandIn: number;
    handedIn: number;
    discrepancy: number;
    unexplainedDiscrepancy: number;
  };
  empties: { collectedFromCustomers: number; returnedToWarehouse: number; discrepancy: number };
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
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    if (!open) { setData(null); return; }
    setLoading(true);
    setData(null);
    dailySheetsApi.getReconciliationPreview(sheetId)
      .then((d) => setData(d as ReconcileData))
      .catch(() => { toast.error('Failed to load reconciliation preview'); onClose(); })
      .finally(() => setLoading(false));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleClose = () => { setData(null); setConfirmClose(false); onClose(); };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      {/*
       * flex flex-col + overflow-hidden: sticky header/footer with scrollable body.
       * p-0: removes base p-6 so each zone controls its own padding.
       * max-h-[90dvh]: caps at 90% dynamic viewport height (handles mobile chrome).
       * twMerge in cn() resolves the grid→flex and p-6→p-0 conflicts.
       */}
      <DialogContent className="rounded-3xl max-w-lg flex flex-col overflow-hidden p-0 max-h-[90dvh]">

        {/* ── Sticky header ── */}
        <DialogHeader className="flex-shrink-0 px-6 pt-6 pb-4 border-b border-border/40">
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-primary" />
            Close &amp; Reconcile
          </DialogTitle>
        </DialogHeader>

        {/* ── Scrollable body ── */}
        <div className="flex-1 overflow-y-auto min-h-0 px-6 py-4">
          {loading ? (
            <div className="py-12 flex flex-col items-center gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Loading reconciliation data...</p>
            </div>
          ) : data ? (
            <div className="space-y-4">
              {data.pendingCount > 0 && (
                <div className="flex items-start gap-2 px-4 py-3 rounded-2xl bg-destructive/10 border border-destructive/20 text-sm font-semibold text-destructive">
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  <div className="flex-1">
                    <span>{data.pendingCount} item(s) still PENDING — resolve them before closing.</span>
                    {' '}
                    <button type="button" onClick={onClose} className="text-xs font-bold text-amber-600 underline hover:no-underline">Go to Pending Items</button>
                  </div>
                </div>
              )}

              {/* Bottle reconciliation */}
              <div className="rounded-2xl border border-border/50 bg-accent/10 overflow-hidden">
                <div className="px-4 py-2.5 bg-muted/40 border-b border-border/40">
                  <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Filled Bottles</p>
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

              {/* Empty bottle reconciliation */}
              {data.empties && (
                <div className="rounded-2xl border border-border/50 bg-accent/10 overflow-hidden">
                  <div className="px-4 py-2.5 bg-muted/40 border-b border-border/40">
                    <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Empty Bottles</p>
                  </div>
                  <div className="p-4 grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-[10px] text-muted-foreground font-bold uppercase">Collected from Customers</p>
                      <p className="text-xl font-black font-mono">{data.empties.collectedFromCustomers}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground font-bold uppercase">Returned to Warehouse</p>
                      <p className="text-xl font-black font-mono">{data.empties.returnedToWarehouse}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground font-bold uppercase">Discrepancy</p>
                      <p className={cn('text-xl font-black font-mono', data.empties.discrepancy !== 0 ? 'text-destructive' : 'text-emerald-600')}>
                        {data.empties.discrepancy > 0 ? '+' : ''}{data.empties.discrepancy}
                        {data.empties.discrepancy !== 0 && ' ⚠️'}
                      </p>
                    </div>
                  </div>
                </div>
              )}

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
                data.driver.unexplainedDiscrepancy !== 0 ? 'border-destructive/30 bg-destructive/5' : 'border-emerald-500/30 bg-emerald-500/5',
              )}>
                <div className="px-4 py-2.5 border-b border-border/40 bg-muted/40">
                  <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Driver Handover</p>
                </div>
                <div className="p-4 space-y-3">
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div>
                      <p className="text-[9px] font-bold uppercase text-muted-foreground">Cash Collected</p>
                      <p className="text-lg font-black font-mono">₨{data.driver.shouldHandIn.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-[9px] font-bold uppercase text-muted-foreground">Handed In</p>
                      <p className="text-lg font-black font-mono">₨{data.driver.handedIn.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-[9px] font-bold uppercase text-muted-foreground">Net Expected</p>
                      <p className="text-lg font-black font-mono text-primary">₨{data.driver.netToHandIn.toLocaleString()}</p>
                    </div>
                  </div>
                  {(data.expenses?.total ?? 0) > 0 && (
                    <div className="rounded-xl bg-orange-500/10 border border-orange-500/20 px-3 py-2 flex items-center justify-between">
                      <p className="text-[10px] font-bold uppercase text-orange-600">Expenses Paid from Cash</p>
                      <p className="font-mono font-black text-sm text-orange-600">- ₨{(data.expenses?.total ?? 0).toLocaleString()}</p>
                    </div>
                  )}
                  <div className="rounded-xl bg-background/70 border border-border/40 px-3 py-2 flex items-center justify-between">
                    <p className="text-[9px] font-bold uppercase text-muted-foreground">Unexplained Difference</p>
                    <p className={cn('font-mono font-black text-sm', data.driver.unexplainedDiscrepancy !== 0 ? 'text-destructive' : 'text-emerald-600')}>
                      {data.driver.unexplainedDiscrepancy !== 0
                        ? `₨${Math.abs(data.driver.unexplainedDiscrepancy).toLocaleString()} ${data.driver.unexplainedDiscrepancy > 0 ? 'short ⚠️' : 'over'}`
                        : '✓ Clear'}
                    </p>
                  </div>
                </div>
              </div>

              {confirmClose && (
                <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 space-y-3">
                  <p className="text-sm font-bold text-destructive">Close this sheet permanently?</p>
                  <p className="text-xs text-muted-foreground">This action requires admin intervention to undo.</p>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setConfirmClose(false)} className="flex-1">Cancel</Button>
                    <Button size="sm" variant="destructive" disabled={isClosing} onClick={() => closeSheet(undefined, { onSuccess: handleClose })} className="flex-1 rounded-xl font-bold">
                      {isClosing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                      Close Sheet
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </div>

        {/* ── Sticky footer ── */}
        <DialogFooter className="flex-shrink-0 px-6 py-4 border-t border-border/40">
          <Button variant="ghost" onClick={handleClose}>Cancel</Button>
          <Button
            onClick={() => setConfirmClose(true)}
            disabled={isClosing || loading || !data || data.pendingCount > 0 || confirmClose}
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
