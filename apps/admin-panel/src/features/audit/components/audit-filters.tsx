'use client';

import { useEffect, useRef, useState } from 'react';
import { Button, Input, Label } from '@water-supply-crm/ui';
import { X } from 'lucide-react';
import { NativeSelect } from '../../observability/components/native-select';
import type { AuditFacets, VendorOption } from '../api/audit.api';

export interface AuditFilterValues {
  vendorId: string;
  action: string;
  entity: string;
  user: string;
  from: string;
  to: string;
}

interface Props {
  values: AuditFilterValues;
  vendors: VendorOption[];
  facets?: AuditFacets;
  onChange: (patch: Partial<AuditFilterValues>) => void;
  onClear: () => void;
  debounceMs?: number;
}

export function AuditFilters({ values, vendors, facets, onChange, onClear, debounceMs = 400 }: Props) {
  const [user, setUser] = useState(values.user);
  const first = useRef(true);

  // keep the box in sync when the URL changes externally (clear / back button)
  useEffect(() => setUser(values.user), [values.user]);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (user === values.user) return;
    const t = setTimeout(() => onChange({ user }), debounceMs);
    return () => clearTimeout(t);
  }, [user]);

  const hasFilters = Object.values(values).some(Boolean);

  return (
    <div className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="audit-filters">
      <div className="space-y-1">
        <Label htmlFor="audit-vendor">Vendor</Label>
        <NativeSelect id="audit-vendor" value={values.vendorId} onChange={(e) => onChange({ vendorId: e.target.value })}>
          <option value="">All vendors</option>
          {vendors.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="space-y-1">
        <Label htmlFor="audit-action">Action</Label>
        <NativeSelect id="audit-action" value={values.action} onChange={(e) => onChange({ action: e.target.value })}>
          <option value="">All actions</option>
          {(facets?.actions ?? []).map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="space-y-1">
        <Label htmlFor="audit-entity">Entity</Label>
        <NativeSelect id="audit-entity" value={values.entity} onChange={(e) => onChange({ entity: e.target.value })}>
          <option value="">All entities</option>
          {(facets?.entities ?? []).map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="space-y-1">
        <Label htmlFor="audit-user">User (name or ID)</Label>
        <Input id="audit-user" value={user} onChange={(e) => setUser(e.target.value)} placeholder="Search user" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="audit-from">From</Label>
        <Input id="audit-from" type="date" value={values.from} onChange={(e) => onChange({ from: e.target.value })} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="audit-to">To</Label>
        <Input id="audit-to" type="date" value={values.to} onChange={(e) => onChange({ to: e.target.value })} />
      </div>
      <div className="flex items-end">
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={onClear}>
            <X className="mr-1 h-4 w-4" />
            Clear filters
          </Button>
        )}
      </div>
    </div>
  );
}
