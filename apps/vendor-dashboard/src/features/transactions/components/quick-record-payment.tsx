'use client';

import { useEffect, useState } from 'react';
import {
  Button, Input, Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@water-supply-crm/ui';
import { CreditCard, Loader2, Search } from 'lucide-react';
import { cn } from '@water-supply-crm/ui';
import { useCustomerSearch } from '../../customers/hooks/use-customers';
import { PaymentForm } from './payment-form';

interface QuickRecordPaymentProps {
  className?: string;
  buttonClassName?: string;
  buttonLabel?: string;
  variant?: 'default' | 'outline' | 'ghost' | 'secondary';
  size?: 'default' | 'sm' | 'lg' | 'icon';
  /** Render a bare trigger (e.g. icon button) instead of the default labelled button. */
  trigger?: (open: () => void) => React.ReactNode;
}

/**
 * Global "Record Payment" quick action — search a customer by name/code/phone,
 * then record a payment for them without navigating to their detail page first.
 * Drop this into the header, transactions page, or anywhere else it's needed;
 * it's self-contained (owns its own dialog + sheet state).
 */
export function QuickRecordPayment({
  className,
  buttonClassName,
  buttonLabel = 'Record Payment',
  variant = 'default',
  size = 'default',
  trigger,
}: QuickRecordPaymentProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [paymentCustomerId, setPaymentCustomerId] = useState<string | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);

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
    setPaymentCustomerId(id);
    setPaymentOpen(true);
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
          className={cn('rounded-xl shadow-lg shadow-primary/20 gap-2 font-bold', buttonClassName)}
        >
          <CreditCard className="h-4 w-4" />
          <span className="hidden sm:inline whitespace-nowrap">{buttonLabel}</span>
        </Button>
      )}

      <Dialog open={pickerOpen} onOpenChange={(open) => { setPickerOpen(open); if (!open) setSearch(''); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5 text-primary" />
              Record Payment
            </DialogTitle>
            <DialogDescription>Search a customer by name, code or phone to get started.</DialogDescription>
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

      {paymentCustomerId && (
        <PaymentForm open={paymentOpen} onOpenChange={setPaymentOpen} customerId={paymentCustomerId} />
      )}
    </div>
  );
}
