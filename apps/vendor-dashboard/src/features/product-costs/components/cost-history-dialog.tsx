'use client';

import { useState } from 'react';
import { History, PlusCircle, Pencil, Ban, Inbox } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  Button, Badge, Skeleton, cn,
} from '@water-supply-crm/ui';
import { useCan } from '../../authz/hooks/use-can';
import { useProductCostHistory } from '../hooks/use-product-costs';
import type { ProductCost } from '../api/product-costs.api';
import { AddCostForm } from './add-cost-form';
import { EditCostForm } from './edit-cost-form';
import { VoidCostDialog } from './void-cost-dialog';

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Historical Product Cost & COGS (docs/features/product-cost-history-and-cogs.md
 * §7.2/§7.3/§7.4) — most-recent-first timeline for one product, scoped to a
 * dialog opened from the Products list (mirrors Fleet's per-vehicle Meter
 * Readings tab and Payroll's SalaryStructure history view, per project
 * precedent, adapted to a dialog since this is a secondary/occasional view
 * rather than primary navigation).
 *
 * Row-level action visibility (design doc §7.3/§7.6 — hide rather than
 * disable ungranted/inapplicable UI):
 * - **Void** only ever renders on the row that IS the current/open row
 *   (`effectiveTo === null && !voidedAt`) — this is fully determined by the
 *   already-loaded history list, matching §4.3's "only the latest row" rule.
 * - **Edit** — 2026-09-15 polish: the backend's `GET .../product/:productId`
 *   response now includes a computed `row.isEditable` flag (`product-cost.
 *   service.ts`'s `listHistory`, bulk-computed from the same
 *   zero-deliveries-in-range rule `editCostPerUnit` itself enforces). Edit
 *   renders only when `row.isEditable` is true, so a row with real delivery
 *   history never shows an Edit action a submit would just reject — closing
 *   the gap the initial build's frontend agent flagged (Edit used to render
 *   on every non-voided row and rely on a 409 + toast). The backend's own
 *   409 check is still the authoritative guard (never trust this client-side
 *   flag alone for a financial mutation) — this is a UX improvement on top
 *   of it, not a replacement for it.
 */
interface CostHistoryDialogProps {
  product: { id: string; name: string } | null;
  onOpenChange: (open: boolean) => void;
}

export function CostHistoryDialog({ product, onOpenChange }: CostHistoryDialogProps) {
  const canView = useCan('product_costs:view');
  const canManage = useCan('product_costs:manage');

  const open = !!product && canView;
  const { data: history, isLoading } = useProductCostHistory(product?.id, open);

  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ProductCost | null>(null);
  const [voidTarget, setVoidTarget] = useState<ProductCost | null>(null);

  if (!product) return null;

  const rows = history ?? [];
  const currentRowId = rows.find((r) => r.effectiveTo === null && !r.voidedAt)?.id;

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => { if (!o) onOpenChange(false); }}>
        <DialogContent className="rounded-3xl max-w-lg max-h-[85dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl font-black flex items-center gap-2">
              <History className="h-5 w-5 text-primary" />
              Cost History — {product.name}
            </DialogTitle>
            <DialogDescription>
              Versioned plant cost per unit over time. Used to compute COGS/margin on Financial Analytics — never
              affects delivery pricing.
            </DialogDescription>
          </DialogHeader>

          {canManage && (
            <div className="flex justify-end">
              <Button size="sm" className="rounded-xl font-bold gap-1.5" onClick={() => setAddOpen(true)}>
                <PlusCircle className="h-4 w-4" /> Add Cost
              </Button>
            </div>
          )}

          {isLoading ? (
            <div className="space-y-2 py-2">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full rounded-2xl" />)}
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-10">
              <div className="p-5 rounded-2xl bg-white/[0.01] border border-border">
                <Inbox className="h-8 w-8 text-muted-foreground/40" />
              </div>
              <p className="text-sm font-bold text-muted-foreground/40 text-center">
                No cost history yet — add your first rate to start tracking margin for this product.
              </p>
            </div>
          ) : (
            <div className="relative pl-6 space-y-3 py-2">
              <div className="absolute left-2 top-4 bottom-4 w-px bg-border" />
              {rows.map((row) => {
                const isVoided = !!row.voidedAt;
                const isCurrent = row.id === currentRowId;
                return (
                  <div key={row.id} className="relative">
                    <div
                      className={cn(
                        'absolute -left-4 top-1.5 h-2.5 w-2.5 rounded-full border-2 border-background',
                        isVoided ? 'bg-muted-foreground/40' : isCurrent ? 'bg-primary' : 'bg-muted-foreground/40',
                      )}
                    />
                    <div className={cn('rounded-2xl border border-border/50 bg-card/50 p-3', isVoided && 'opacity-60')}>
                      <div className="flex items-start justify-between gap-2 flex-wrap">
                        <div className="min-w-0">
                          <p className={cn('font-mono font-black text-sm', isVoided && 'line-through text-muted-foreground')}>
                            ₨ {row.costPerUnit.toLocaleString()} per unit
                          </p>
                          <p className={cn('text-xs text-muted-foreground mt-0.5', isVoided && 'line-through')}>
                            effective {formatDate(row.effectiveFrom)} to {row.effectiveTo ? formatDate(row.effectiveTo) : 'present'}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {isVoided && (
                            <Badge className="text-[10px] font-bold px-2 py-0.5 rounded-full border-none bg-destructive/10 text-destructive">
                              VOIDED
                            </Badge>
                          )}
                          {isCurrent && !isVoided && (
                            <Badge className="text-[10px] font-bold px-2 py-0.5 rounded-full border-none bg-primary/10 text-primary">
                              CURRENT
                            </Badge>
                          )}
                        </div>
                      </div>

                      {(row.note || row.invoiceRef) && (
                        <div className="mt-2 space-y-0.5 text-[11px]">
                          {row.note && (
                            <p className="text-muted-foreground">
                              <span className="font-bold">Note:</span> {row.note}
                            </p>
                          )}
                          {row.invoiceRef && (
                            <p className="text-muted-foreground">
                              <span className="font-bold">Invoice ref:</span> {row.invoiceRef}
                            </p>
                          )}
                        </div>
                      )}

                      {isVoided && row.voidReason && (
                        <p className="mt-2 text-[11px] text-muted-foreground">
                          <span className="font-bold">Void reason:</span> {row.voidReason}
                        </p>
                      )}

                      {canManage && !isVoided && (
                        <div className="flex items-center gap-2 mt-3">
                          {row.isEditable && (
                            <Button
                              size="sm" variant="outline"
                              className="h-7 rounded-full text-[10px] px-2.5 font-bold gap-1"
                              onClick={() => setEditTarget(row)}
                            >
                              <Pencil className="h-3 w-3" /> Edit
                            </Button>
                          )}
                          {isCurrent && (
                            <Button
                              size="sm" variant="outline"
                              className="h-7 rounded-full text-[10px] px-2.5 font-bold gap-1 text-destructive"
                              onClick={() => setVoidTarget(row)}
                            >
                              <Ban className="h-3 w-3" /> Void
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {canManage && (
        <>
          <AddCostForm
            open={addOpen}
            onOpenChange={setAddOpen}
            productId={product.id}
            productName={product.name}
            history={rows}
          />
          <EditCostForm row={editTarget} productId={product.id} onOpenChange={(o) => { if (!o) setEditTarget(null); }} />
          <VoidCostDialog row={voidTarget} productId={product.id} onOpenChange={(o) => { if (!o) setVoidTarget(null); }} />
        </>
      )}
    </>
  );
}
