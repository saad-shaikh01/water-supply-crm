'use client';

import { useEffect, useState } from 'react';
import { Loader2, Settings2 } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
  Badge, Button, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  Skeleton, Textarea,
} from '@water-supply-crm/ui';
import { useCan } from '../../authz/hooks/use-can';
import {
  useCustomerFlagCategories,
  useCustomerFlagHistory,
  useApplyCustomerFlag,
  useResolveCustomerFlag,
} from '../hooks/use-customer-flags';
import { ManageCustomerFlagCategoriesDialog } from './manage-customer-flag-categories-dialog';

interface CustomerFlagsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerId: string;
  customerName: string;
}

/**
 * Flag / resolve dialog for one customer (owner-requested 2026-09-29) — the
 * add and remove flow the highlight badge needs on both ends. Open flags are
 * listed with an inline resolve action (optional reason); the "add flag"
 * section picks a category and pre-fills its default message, editable
 * before submitting. Categories are managed separately via the nested
 * "Manage categories" dialog (admin-only).
 */
export function CustomerFlagsDialog({ open, onOpenChange, customerId, customerName }: CustomerFlagsDialogProps) {
  const canApply = useCan('customer_flags:apply');
  const canManageCategories = useCan('customer_flags:manage_categories');

  const { data: categories, isLoading: categoriesLoading } = useCustomerFlagCategories(open);
  const { data: history, isLoading: historyLoading } = useCustomerFlagHistory(customerId, open);
  const { mutate: applyFlag, isPending: isApplying } = useApplyCustomerFlag();
  const { mutate: resolveFlag, isPending: isResolving } = useResolveCustomerFlag();

  const [categoryId, setCategoryId] = useState('');
  const [message, setMessage] = useState('');
  const [manageOpen, setManageOpen] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [resolveReason, setResolveReason] = useState('');

  const activeCategories = (categories ?? []).filter((c) => c.isActive);
  const openFlags = (history ?? []).filter((f) => f.status === 'OPEN');
  const resolvedFlags = (history ?? []).filter((f) => f.status === 'RESOLVED');

  useEffect(() => {
    if (!open) {
      setCategoryId('');
      setMessage('');
      setResolvingId(null);
      setResolveReason('');
    }
  }, [open]);

  function handleCategoryChange(id: string) {
    setCategoryId(id);
    const cat = activeCategories.find((c) => c.id === id);
    setMessage(cat?.defaultMessage ?? '');
  }

  function handleApply() {
    if (!categoryId || !message.trim()) return;
    applyFlag(
      { customerId, data: { categoryId, message: message.trim() } },
      { onSuccess: () => { setCategoryId(''); setMessage(''); } },
    );
  }

  function handleResolve(flagId: string) {
    resolveFlag(
      { customerId, flagId, data: { resolvedReason: resolveReason.trim() || undefined } },
      { onSuccess: () => { setResolvingId(null); setResolveReason(''); } },
    );
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="rounded-3xl max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl font-black">Flags — {customerName}</DialogTitle>
            <DialogDescription>
              Highlight this customer wherever they&apos;re shown (list, daily sheets, chats) so staff know what&apos;s
              going on. Resolving a flag removes the highlight but keeps it in history.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Active flags</Label>
            {historyLoading ? (
              <Skeleton className="h-14 rounded-xl" />
            ) : openFlags.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">No active flags on this customer.</p>
            ) : (
              <div className="space-y-2">
                {openFlags.map((flag) => (
                  <div key={flag.id} className="rounded-xl border px-3 py-2 space-y-1.5" style={{ borderColor: `${flag.category.color}40` }}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: flag.category.color }} />
                        <span className="text-sm font-bold truncate">{flag.category.name}</span>
                      </div>
                      {canApply && resolvingId !== flag.id && (
                        <Button type="button" size="sm" variant="outline" className="h-7 rounded-full text-xs" onClick={() => setResolvingId(flag.id)}>
                          Resolve
                        </Button>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{flag.message}</p>
                    <p className="text-[10px] text-muted-foreground/70">
                      Flagged by {flag.createdByName} on {new Date(flag.createdAt).toLocaleDateString()}
                    </p>
                    {resolvingId === flag.id && (
                      <div className="pt-1 space-y-2">
                        <Textarea
                          className="rounded-lg text-xs"
                          rows={2}
                          placeholder="Why is this resolved? (optional)"
                          value={resolveReason}
                          onChange={(e) => setResolveReason(e.target.value)}
                        />
                        <div className="flex justify-end gap-2">
                          <Button type="button" size="sm" variant="ghost" onClick={() => { setResolvingId(null); setResolveReason(''); }}>
                            Cancel
                          </Button>
                          <Button type="button" size="sm" disabled={isResolving} onClick={() => handleResolve(flag.id)}>
                            {isResolving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Confirm resolve'}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {canApply && (
            <div className="space-y-3 rounded-2xl border p-3">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Add a flag</Label>
              <Select value={categoryId} onValueChange={handleCategoryChange} disabled={categoriesLoading}>
                <SelectTrigger className="rounded-xl">
                  <SelectValue placeholder="Choose a category" />
                </SelectTrigger>
                <SelectContent>
                  {activeCategories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      <span className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: c.color }} />
                        {c.name}
                      </span>
                    </SelectItem>
                  ))}
                  {activeCategories.length === 0 && !categoriesLoading && (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">No categories yet</div>
                  )}
                </SelectContent>
              </Select>
              <Textarea
                className="rounded-xl"
                rows={2}
                maxLength={500}
                placeholder="Why is this customer flagged?"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
              <Button
                type="button"
                className="w-full rounded-xl font-bold"
                disabled={isApplying || !categoryId || !message.trim()}
                onClick={handleApply}
              >
                {isApplying ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Apply flag'}
              </Button>
            </div>
          )}

          {resolvedFlags.length > 0 && (
            <details className="rounded-xl border px-3 py-2">
              <summary className="text-xs font-bold text-muted-foreground cursor-pointer select-none">
                Resolved history ({resolvedFlags.length})
              </summary>
              <div className="mt-2 space-y-2">
                {resolvedFlags.map((flag) => (
                  <div key={flag.id} className="text-xs border-t pt-2 first:border-t-0 first:pt-0">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[9px]">{flag.category.name}</Badge>
                      <span className="text-muted-foreground/70">
                        {flag.createdAt && new Date(flag.createdAt).toLocaleDateString()} → resolved by{' '}
                        {flag.resolvedByName} on {flag.resolvedAt && new Date(flag.resolvedAt).toLocaleDateString()}
                      </span>
                    </div>
                    <p className="text-muted-foreground mt-0.5">{flag.message}</p>
                    {flag.resolvedReason && <p className="text-muted-foreground/70 italic">Resolved: {flag.resolvedReason}</p>}
                  </div>
                ))}
              </div>
            </details>
          )}

          {canManageCategories && (
            <Button type="button" variant="ghost" size="sm" className="w-fit gap-1.5 text-xs text-muted-foreground" onClick={() => setManageOpen(true)}>
              <Settings2 className="h-3.5 w-3.5" />
              Manage categories
            </Button>
          )}
        </DialogContent>
      </Dialog>

      <ManageCustomerFlagCategoriesDialog open={manageOpen} onOpenChange={setManageOpen} />
    </>
  );
}
