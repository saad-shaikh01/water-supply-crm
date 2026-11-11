'use client';

import { useEffect, useState } from 'react';
import { Input, Label } from '@water-supply-crm/ui';
import { NativeSelect } from '../observability/components/native-select';
import { useVendorSearch } from './vendor-picker';

interface Props {
  id: string;
  value: string;
  onChange: (vendorId: string) => void;
  label?: string;
  error?: string;
  disabled?: boolean;
  /** Shown as the selected option when the vendor is not in the current search result. */
  selectedName?: string;
}

/** Search box + select over a server-side vendor search. */
export function VendorSelect({ id, value, onChange, label = 'Vendor', error, disabled, selectedName }: Props) {
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);
  const vendors = useVendorSearch(q);
  const options = vendors.data ?? [];
  const hasSelected = !value || options.some((v) => v.id === value);

  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      {!disabled && (
        <Input aria-label={`Search ${label.toLowerCase()}`} placeholder="Search vendors" value={search} onChange={(e) => setSearch(e.target.value)} />
      )}
      <NativeSelect id={id} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} aria-invalid={!!error}>
        <option value="">{vendors.isLoading ? 'Loading...' : 'Select a vendor'}</option>
        {!hasSelected && <option value={value}>{selectedName ?? value}</option>}
        {options.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name}
          </option>
        ))}
      </NativeSelect>
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
