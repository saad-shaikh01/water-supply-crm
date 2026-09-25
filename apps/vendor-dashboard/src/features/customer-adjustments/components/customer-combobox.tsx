'use client';

import { useRef, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { Input, cn } from '@water-supply-crm/ui';
import { useCustomerSearch } from '../../customers/hooks/use-customers';
import { fmtAdjustmentAmount } from '../format';

/**
 * Debounced customer-search combobox — extracted from `transfer-balance-dialog.tsx`
 * (the balance-transfer "target customer" picker) so it can also back the "link to
 * a customer" field on the Linked Penalty flow (owner-approved 2026-09-25). No
 * other generic customer picker exists in the app.
 */
export interface CustomerComboboxProps {
  id: string;
  value: string; // selected customerId
  onChange: (id: string, name: string) => void;
  excludeId?: string; // a customer to exclude from results (e.g. the source of a transfer)
  error?: string;
  placeholder?: string;
}

export function CustomerCombobox({
  id,
  value,
  onChange,
  excludeId,
  error,
  placeholder = 'Search by name or customer code…',
}: CustomerComboboxProps) {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: results, isFetching } = useCustomerSearch(debouncedQuery, open || debouncedQuery.length > 0);

  const customers = (results as any)?.data ?? [];
  const filtered = customers.filter((c: { id: string }) => c.id !== excludeId);

  const handleInput = (raw: string) => {
    setQuery(raw);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQuery(raw), 300);
    if (!open) setOpen(true);
  };

  const select = (customer: { id: string; name: string; customerCode: string }) => {
    onChange(customer.id, customer.name);
    setQuery(`${customer.name} (${customer.customerCode})`);
    setOpen(false);
  };

  const clear = () => {
    onChange('', '');
    setQuery('');
    setDebouncedQuery('');
    setOpen(false);
  };

  return (
    <div className="relative">
      <div className="relative flex items-center">
        <Input
          id={id}
          value={query}
          onChange={(e) => handleInput(e.target.value)}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className={cn('h-10 rounded-xl pr-8', error && 'border-destructive')}
          autoComplete="off"
        />
        {(value || query) && (
          <button
            type="button"
            onClick={clear}
            className="absolute right-2.5 text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Clear"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {open && (query.length > 0 || debouncedQuery.length > 0) && (
        <div className="absolute z-50 mt-1 w-full rounded-xl border border-border bg-popover shadow-xl overflow-hidden">
          {isFetching ? (
            <div className="flex items-center gap-2 px-4 py-3 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching…
            </div>
          ) : filtered.length === 0 ? (
            <p className="px-4 py-3 text-xs text-muted-foreground">No customers found.</p>
          ) : (
            <ul className="max-h-52 overflow-y-auto">
              {filtered.map((c: { id: string; name: string; customerCode: string; financialBalance: number }) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => select(c)}
                    className={cn(
                      'w-full flex items-center justify-between gap-3 px-4 py-2.5 text-xs text-left hover:bg-accent/60 transition-colors',
                      value === c.id && 'bg-primary/10',
                    )}
                  >
                    <span>
                      <span className="font-semibold">{c.name}</span>
                      <span className="ml-2 font-mono text-muted-foreground">{c.customerCode}</span>
                    </span>
                    <span
                      className={cn(
                        'font-mono font-bold shrink-0',
                        Number(c.financialBalance) > 0 ? 'text-rose-400' : 'text-emerald-400',
                      )}
                    >
                      {Number(c.financialBalance) > 0 ? '+' : '−'}{' '}
                      {fmtAdjustmentAmount(Math.abs(Number(c.financialBalance)))}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
