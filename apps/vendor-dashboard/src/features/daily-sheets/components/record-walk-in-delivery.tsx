'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Button, Input, Textarea, Label, cn,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter, SheetDescription,
} from '@water-supply-crm/ui';
import { ChevronDown, Loader2, PackageCheck, Search, Truck } from 'lucide-react';
import { useCustomerSearch } from '../../customers/hooks/use-customers';
import { customersApi } from '../../customers/api/customers.api';
import { productsApi } from '../../products/api/products.api';
import { useRecordWalkInDelivery } from '../hooks/use-daily-sheets';

type Channel = 'SELF_PICKUP' | 'THIRD_PARTY' | 'OTHER';

const CHANNELS: { value: Channel; label: string }[] = [
  { value: 'SELF_PICKUP', label: 'Self-pickup' },
  { value: 'THIRD_PARTY', label: 'Third-party' },
  { value: 'OTHER', label: 'Other' },
];

interface RecordWalkInDeliveryProps {
  className?: string;
  buttonClassName?: string;
  buttonLabel?: string;
  variant?: 'default' | 'outline' | 'ghost' | 'secondary';
  size?: 'default' | 'sm' | 'lg' | 'icon';
  /** Render a custom trigger instead of the default labelled button. */
  trigger?: (open: () => void) => React.ReactNode;
}

/**
 * Global "Record Delivery" quick action for a walk-in / self-pickup delivery —
 * search a customer, then record a delivery for them with no van / odometer /
 * load-out / trip. The backend finds-or-creates the synthetic per-vendor-per-
 * date WALK_IN sheet. Self-contained (owns its own picker + form state).
 */
export function RecordWalkInDelivery({
  className,
  buttonClassName,
  buttonLabel = 'Record Delivery',
  variant = 'outline',
  size = 'default',
  trigger,
}: RecordWalkInDeliveryProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isFetching } = useCustomerSearch(debouncedSearch, pickerOpen);
  const results = ((data as any)?.data ?? []) as Array<{
    id: string; name: string; customerCode?: string; phoneNumber?: string; financialBalance?: number;
  }>;

  const openPicker = () => setPickerOpen(true);

  const selectCustomer = (id: string) => {
    setPickerOpen(false);
    setSearch('');
    setCustomerId(id);
    setFormOpen(true);
  };

  return (
    <div className={className}>
      {trigger ? (
        trigger(openPicker)
      ) : (
        <Button
          onClick={openPicker}
          variant={variant}
          size={size}
          aria-label={buttonLabel}
          className={cn('rounded-xl gap-2 font-bold', buttonClassName)}
        >
          <PackageCheck className="h-4 w-4" />
          <span className="hidden sm:inline whitespace-nowrap">{buttonLabel}</span>
        </Button>
      )}

      <Dialog open={pickerOpen} onOpenChange={(open) => { setPickerOpen(open); if (!open) setSearch(''); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PackageCheck className="h-5 w-5 text-primary" />
              Record Delivery
            </DialogTitle>
            <DialogDescription>
              Walk-in / self-pickup delivery — no van, odometer or trip. Search a customer to start.
            </DialogDescription>
          </DialogHeader>

          <div className="relative">
            <Input
              autoFocus
              placeholder="Search by name, code or phone…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pr-9 h-11 rounded-xl bg-accent/30 border-border/50"
            />
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              {isFetching
                ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                : <Search className="h-4 w-4 text-muted-foreground/50" />}
            </div>
          </div>

          <div className="max-h-72 overflow-y-auto rounded-xl border border-border/50 divide-y divide-border/30">
            {results.length > 0 ? (
              results.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => selectCustomer(c.id)}
                  className="w-full text-left px-3 py-2.5 hover:bg-accent/50 transition-colors"
                >
                  <p className="font-semibold text-sm text-foreground dark:text-white truncate">
                    {c.name}
                    {c.customerCode && (
                      <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">({c.customerCode})</span>
                    )}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {c.financialBalance != null ? `₨${Number(c.financialBalance).toLocaleString()} balance` : ''}
                    {c.phoneNumber ? ` · ${c.phoneNumber}` : ''}
                  </p>
                </button>
              ))
            ) : (
              <p className="px-3 py-6 text-xs text-muted-foreground text-center">
                {isFetching ? 'Searching…' : debouncedSearch ? 'No customers found.' : 'Type to search customers…'}
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {customerId && (
        <WalkInDeliveryForm
          key={customerId}
          open={formOpen}
          onOpenChange={setFormOpen}
          customerId={customerId}
        />
      )}
    </div>
  );
}

// ── The form ──────────────────────────────────────────────────────────────────

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

interface WalkInDeliveryFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerId: string;
}

function WalkInDeliveryForm({ open, onOpenChange, customerId }: WalkInDeliveryFormProps) {
  const { mutate: record, isPending } = useRecordWalkInDelivery();

  const { data: customer } = useQuery({
    queryKey: ['customer', customerId],
    queryFn: () => customersApi.getOne(customerId).then((r) => r.data),
    enabled: !!customerId && open,
  });

  const { data: productsData } = useQuery({
    queryKey: ['walk-in-products'],
    queryFn: () => productsApi.getAll({ page: 1, limit: 100, isActive: true }).then((r) => r.data),
    enabled: open,
  });
  const products = (((productsData as any)?.data ?? (productsData as any)?.items ?? []) as Array<{
    id: string; name: string; basePrice?: number;
  }>);

  const wallets = ((customer as any)?.wallets ?? []) as Array<{ balance: number; product: { id: string; name: string } }>;
  const customPrices = ((customer as any)?.customPrices ?? []) as Array<{ productId: string; customPrice: number }>;
  const isBillingExempt = !!(customer as any)?.isBillingExempt;
  const balance = Number((customer as any)?.financialBalance ?? 0);

  const [productId, setProductId] = useState('');
  const [date, setDate] = useState(todayStr());
  const [filledDropped, setFilledDropped] = useState<number | undefined>(undefined);
  const [emptyReceived, setEmptyReceived] = useState<number | undefined>(undefined);
  const [filledReceived, setFilledReceived] = useState<number | undefined>(undefined);
  const [showFilledReceived, setShowFilledReceived] = useState(false);
  const [cashCollected, setCashCollected] = useState<number | undefined>(undefined);
  const [channel, setChannel] = useState<Channel>('OTHER');
  const [note, setNote] = useState('');
  const [sendWhatsapp, setSendWhatsapp] = useState(true);

  // Reset on (re)open, and default-select the customer's current product.
  useEffect(() => {
    if (!open) return;
    setDate(todayStr());
    setFilledDropped(undefined);
    setEmptyReceived(undefined);
    setFilledReceived(undefined);
    setShowFilledReceived(false);
    setCashCollected(undefined);
    setChannel('OTHER');
    setNote('');
    setSendWhatsapp(true);
  }, [open, customerId]);

  useEffect(() => {
    if (productId) return;
    // Prefer the product this customer actually buys: a custom price, else the
    // wallet with the highest balance, else the first product (the 19L default).
    const byCustomPrice = customPrices[0]?.productId;
    const byWallet = [...wallets].sort((a, b) => b.balance - a.balance)[0]?.product?.id;
    const fallback = products[0]?.id;
    const next = byCustomPrice || byWallet || fallback || '';
    if (next) setProductId(next);
  }, [customPrices, wallets, products, productId]);

  const selectedProduct = products.find((p) => p.id === productId);
  const rate = useMemo(() => {
    if (isBillingExempt) return 0;
    const cp = customPrices.find((c) => c.productId === productId);
    return cp ? Number(cp.customPrice) : Number(selectedProduct?.basePrice ?? 0);
  }, [isBillingExempt, customPrices, productId, selectedProduct]);

  const dropped = filledDropped ?? 0;
  const empty = emptyReceived ?? 0;
  const filledBack = filledReceived ?? 0;
  const cash = cashCollected ?? 0;
  const amount = dropped * rate;
  const walletBalance = wallets.find((w) => w.product.id === productId)?.balance ?? 0;
  const newWallet = walletBalance + dropped - empty - filledBack;
  const newBalance = balance + amount - cash;

  const hasQty = dropped > 0 || empty > 0 || filledBack > 0;
  const walletWouldGoNegative = empty + filledBack > walletBalance + dropped;
  const isFuture = date > todayStr();
  const isValid = !!productId && hasQty && !walletWouldGoNegative && !isFuture;

  const submit = () => {
    if (!isValid) return;
    record(
      {
        customerId,
        productId,
        filledDropped: dropped,
        emptyReceived: empty,
        filledReceived: filledBack,
        cashCollected: cash,
        date,
        deliveryChannel: channel,
        note: note.trim() || undefined,
        sendWhatsapp,
      },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto bg-background/95 backdrop-blur-xl border-l border-border/50">
        <SheetHeader className="pb-6 border-b">
          <SheetTitle className="text-2xl font-bold flex items-center gap-2">
            <Truck className="h-6 w-6 text-primary" />
            Record Delivery
          </SheetTitle>
          <SheetDescription>
            {(customer as any)?.name
              ? `Walk-in / self-pickup delivery for ${(customer as any).name}.`
              : 'Walk-in / self-pickup delivery.'}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-5 py-6">
          {/* Date */}
          <div className="space-y-2">
            <Label className="text-sm font-semibold">Date</Label>
            <Input
              type="date"
              value={date}
              max={todayStr()}
              onChange={(e) => setDate(e.target.value)}
              className="h-11 bg-accent/30 border-border/50"
            />
            {isFuture && (
              <p className="text-xs font-medium text-destructive">Date cannot be in the future.</p>
            )}
          </div>

          {/* Product */}
          <div className="space-y-2">
            <Label className="text-sm font-semibold">Product</Label>
            <select
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              className="w-full h-11 rounded-xl bg-accent/30 border border-border/50 text-sm text-foreground dark:text-white px-3 outline-none focus:ring-2 focus:ring-primary/30"
            >
              {products.map((p) => (
                <option key={p.id} value={p.id} className="bg-background text-foreground dark:text-white">
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          {/* Quantities */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-sm font-semibold">Filled delivered</Label>
              <Input
                type="number"
                min={0}
                value={filledDropped ?? ''}
                onChange={(e) => setFilledDropped(e.target.value === '' ? undefined : Number(e.target.value))}
                className="h-11 font-mono font-bold bg-accent/30 border-border/50"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-semibold">Empty received</Label>
              <Input
                type="number"
                min={0}
                value={emptyReceived ?? ''}
                onChange={(e) => setEmptyReceived(e.target.value === '' ? undefined : Number(e.target.value))}
                className="h-11 font-mono font-bold bg-accent/30 border-border/50"
              />
            </div>
          </div>

          {/* Filled received — collapsed by default (mirrors daily-sheet form) */}
          {showFilledReceived ? (
            <div className="space-y-2">
              <Label className="text-sm font-semibold">Filled received (returned)</Label>
              <Input
                type="number"
                min={0}
                value={filledReceived ?? ''}
                onChange={(e) => setFilledReceived(e.target.value === '' ? undefined : Number(e.target.value))}
                className="h-11 font-mono font-bold bg-accent/30 border-border/50"
              />
              <p className="text-[11px] text-muted-foreground">
                Already-filled bottles the customer returned (account closing / excess stock).
              </p>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowFilledReceived(true)}
              className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronDown className="h-3.5 w-3.5" />
              Add filled received (returned bottles)
            </button>
          )}

          {/* Cash */}
          <div className="space-y-2">
            <Label className="text-sm font-semibold">Cash collected (₨)</Label>
            <Input
              type="number"
              min={0}
              step="0.01"
              placeholder="0"
              value={cashCollected ?? ''}
              onChange={(e) => setCashCollected(e.target.value === '' ? undefined : Number(e.target.value))}
              className="h-11 font-mono font-bold bg-accent/30 border-border/50"
            />
            <p className="text-[11px] text-muted-foreground">Leave blank if nothing was collected — the charge stays on the balance.</p>
          </div>

          {/* Channel */}
          <div className="space-y-2">
            <Label className="text-sm font-semibold">Channel</Label>
            <div className="grid grid-cols-3 gap-2">
              {CHANNELS.map((c) => {
                const active = channel === c.value;
                return (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setChannel(c.value)}
                    className={cn(
                      'py-2.5 px-2 rounded-xl border-2 text-xs font-bold transition-all',
                      active
                        ? 'bg-primary/10 border-primary text-primary'
                        : 'bg-background border-border/50 text-muted-foreground hover:border-primary/30',
                    )}
                  >
                    {c.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Note */}
          <div className="space-y-2">
            <Label className="text-sm font-semibold">Note</Label>
            <Textarea
              placeholder="e.g. Picked up from plant, or the third-party name"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="min-h-[70px] bg-accent/30 border-border/50"
            />
          </div>

          {/* WhatsApp toggle */}
          <button
            type="button"
            onClick={() => setSendWhatsapp((v) => !v)}
            className={cn(
              'w-full flex items-center justify-between rounded-xl border-2 px-4 py-3 text-sm font-semibold transition-all',
              sendWhatsapp
                ? 'bg-primary/10 border-primary text-primary'
                : 'bg-background border-border/50 text-muted-foreground',
            )}
          >
            Send WhatsApp receipt
            <span className={cn(
              'text-[11px] font-bold px-2 py-0.5 rounded-full',
              sendWhatsapp ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
            )}>
              {sendWhatsapp ? 'ON' : 'OFF'}
            </span>
          </button>

          {/* Live preview */}
          <div className="rounded-xl bg-primary/5 border border-primary/10 divide-y divide-primary/10 text-sm">
            <div className="p-3 flex justify-between">
              <span className="text-muted-foreground">Rate</span>
              <span className="font-mono font-bold">₨{rate.toLocaleString()}/bottle</span>
            </div>
            <div className="p-3 flex justify-between">
              <span className="text-muted-foreground">Amount</span>
              <span className="font-mono font-bold">₨{amount.toLocaleString()}</span>
            </div>
            <div className="p-3 flex justify-between">
              <span className="text-muted-foreground">New balance</span>
              <span className={cn('font-mono font-black', newBalance > 0 ? 'text-amber-500' : 'text-emerald-500')}>
                ₨{newBalance.toLocaleString()}
              </span>
            </div>
            <div className="p-3 flex justify-between">
              <span className="text-muted-foreground">New bottle wallet</span>
              <span className={cn('font-mono font-black', newWallet < 0 ? 'text-destructive' : '')}>
                {newWallet}
              </span>
            </div>
          </div>

          {walletWouldGoNegative && (
            <p className="text-xs font-medium text-destructive">
              Empty + filled received ({empty + filledBack}) exceeds what the customer holds
              ({walletBalance}) plus delivered ({dropped}).
            </p>
          )}
          {!hasQty && (
            <p className="text-[11px] text-muted-foreground">
              Enter at least one of delivered / empty received / filled received. For a cash-only
              entry use Record Payment.
            </p>
          )}
        </div>

        <SheetFooter className="pt-6 border-t gap-3 sm:gap-0">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={isPending || !isValid} className="min-w-[150px] shadow-lg shadow-primary/20">
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Record Delivery'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
