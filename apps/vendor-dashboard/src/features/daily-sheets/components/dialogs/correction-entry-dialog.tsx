'use client';

import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button, Input, Label,
} from '@water-supply-crm/ui';
import { AlertTriangle, Loader2, ClipboardEdit } from 'lucide-react';
import { useAddCorrectionItem } from '../../hooks/use-daily-sheets';
import { productsApi } from '../../../products/api/products.api';
import { customersApi } from '../../../customers/api/customers.api';

interface CorrectionEntryDialogProps {
  open: boolean;
  onClose: () => void;
  sheetId: string;
}

const emptyForm = {
  customerId: '',
  customerName: '',
  productId: '',
  filledDropped: 1,
  emptyReceived: 0,
  cashCollected: 0,
  correctionNote: '',
};

export function CorrectionEntryDialog({ open, onClose, sheetId }: CorrectionEntryDialogProps) {
  const { mutate: addCorrectionItem, isPending } = useAddCorrectionItem(sheetId);

  const [form, setForm] = useState(emptyForm);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Reset form when dialog opens/closes
  useEffect(() => {
    if (open) {
      setForm(emptyForm);
      setSearchQuery('');
      setDebouncedQuery('');
      setShowDropdown(false);
    }
  }, [open]);

  // Debounce the search query
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchQuery]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const { data: customerSearchData, isFetching: isSearching } = useQuery({
    queryKey: ['correction-customer-search', debouncedQuery],
    queryFn: () =>
      customersApi.getAll({ search: debouncedQuery, limit: 20, isActive: true }).then((r) => r.data),
    enabled: debouncedQuery.length >= 1,
  });

  const searchResults: { id: string; name: string; customerCode?: string }[] =
    (customerSearchData as any)?.data ?? (customerSearchData as any)?.items ?? [];

  const { data: productsData } = useQuery({
    queryKey: ['correction-products'],
    queryFn: () => productsApi.getAll({ page: 1, limit: 100, isActive: true }).then((r) => r.data),
  });

  const products: { id: string; name: string }[] =
    (productsData as any)?.data ?? (productsData as any)?.items ?? [];

  // Auto-select first product when products load and none selected
  useEffect(() => {
    if (products.length > 0 && !form.productId) {
      setForm((p) => ({ ...p, productId: products[0].id }));
    }
  }, [products]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelectCustomer = (customer: { id: string; name: string }) => {
    setForm((p) => ({ ...p, customerId: customer.id, customerName: customer.name }));
    setSearchQuery(customer.name);
    setShowDropdown(false);
  };

  const handleSubmit = () => {
    if (!form.customerId || !form.productId || form.correctionNote.trim().length < 3) return;
    addCorrectionItem({
      customerId: form.customerId,
      productId: form.productId,
      filledDropped: form.filledDropped,
      emptyReceived: form.emptyReceived,
      cashCollected: form.cashCollected,
      correctionNote: form.correctionNote.trim(),
    }, { onSuccess: onClose });
  };

  const isValid =
    !!form.customerId &&
    !!form.productId &&
    form.filledDropped >= 0 &&
    form.correctionNote.trim().length >= 3;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="rounded-3xl max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <ClipboardEdit className="h-5 w-5 text-amber-500" />
            Add Missed Delivery
          </DialogTitle>
        </DialogHeader>

        {/* Warning Banner */}
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-700 dark:text-amber-400 font-medium leading-relaxed">
            You are adding a delivery to a closed sheet. This will update the customer&apos;s balance.
          </p>
        </div>

        <div className="space-y-4 py-2">
          {/* Customer Search */}
          <div className="space-y-2 relative" ref={dropdownRef}>
            <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
              Customer <span className="text-destructive">*</span>
            </Label>
            <div className="relative">
              <Input
                placeholder="Search by name or code..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setForm((p) => ({ ...p, customerId: '', customerName: '' }));
                  setShowDropdown(true);
                }}
                onFocus={() => {
                  if (searchQuery.length >= 1) setShowDropdown(true);
                }}
                className="pr-8"
              />
              {isSearching && (
                <Loader2 className="absolute right-2.5 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />
              )}
            </div>
            {showDropdown && searchResults.length > 0 && (
              <div className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-xl shadow-lg max-h-48 overflow-y-auto">
                {searchResults.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors flex items-center gap-2"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      handleSelectCustomer(c);
                    }}
                  >
                    <span className="font-semibold">{c.name}</span>
                    {c.customerCode && (
                      <span className="text-[10px] font-mono text-muted-foreground">({c.customerCode})</span>
                    )}
                  </button>
                ))}
              </div>
            )}
            {showDropdown && debouncedQuery.length >= 1 && !isSearching && searchResults.length === 0 && (
              <div className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-xl shadow-lg px-3 py-2 text-sm text-muted-foreground">
                No customers found
              </div>
            )}
          </div>

          {/* Product Select */}
          {products.length > 0 && (
            <div className="space-y-2">
              <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
                Product <span className="text-destructive">*</span>
              </Label>
              <select
                value={form.productId}
                onChange={(e) => setForm((p) => ({ ...p, productId: e.target.value }))}
                className="w-full h-10 rounded-xl bg-background/50 border border-border/50 text-sm text-foreground dark:text-white px-3 outline-none focus:ring-2 focus:ring-primary/30"
              >
                {products.map((prod) => (
                  <option key={prod.id} value={prod.id} className="bg-background text-foreground dark:text-white">
                    {prod.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Numeric Fields */}
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">Filled Dropped</Label>
              <Input
                type="number"
                min={0}
                value={form.filledDropped}
                onChange={(e) => setForm((p) => ({ ...p, filledDropped: Number(e.target.value) }))}
                className="font-mono font-bold"
              />
            </div>
            <div className="space-y-2">
              <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">Empty Received</Label>
              <Input
                type="number"
                min={0}
                value={form.emptyReceived}
                onChange={(e) => setForm((p) => ({ ...p, emptyReceived: Number(e.target.value) }))}
                className="font-mono font-bold"
              />
            </div>
            <div className="space-y-2">
              <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">Cash Collected (₨)</Label>
              <Input
                type="number"
                min={0}
                value={form.cashCollected}
                onChange={(e) => setForm((p) => ({ ...p, cashCollected: Number(e.target.value) }))}
                className="font-mono font-bold"
              />
            </div>
          </div>

          {/* Correction Reason */}
          <div className="space-y-2">
            <Label className="font-bold text-xs uppercase tracking-widest text-amber-600 dark:text-amber-400">
              Correction Reason <span className="text-destructive">*</span>
            </Label>
            <textarea
              value={form.correctionNote}
              onChange={(e) => setForm((p) => ({ ...p, correctionNote: e.target.value }))}
              placeholder="Explain why this delivery was missed and is being added retroactively..."
              rows={3}
              className="w-full rounded-xl bg-background/50 border border-border/50 text-sm text-foreground dark:text-white px-3 py-2 outline-none focus:ring-2 focus:ring-amber-500/30 resize-none placeholder:text-muted-foreground"
            />
            {form.correctionNote.trim().length > 0 && form.correctionNote.trim().length < 3 && (
              <p className="text-[11px] text-destructive">Reason must be at least 3 characters.</p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={isPending}>Cancel</Button>
          <Button
            onClick={handleSubmit}
            disabled={isPending || !isValid}
            className="rounded-xl font-bold bg-amber-500 hover:bg-amber-600 text-white"
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Save Correction
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
