'use client';

import { useQueryState, parseAsString } from 'nuqs';
import { useQuery } from '@tanstack/react-query';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@water-supply-crm/ui';
import { usersApi } from '../../../features/users/api/users.api';

interface SalesmanFilterProps {
  onBeforeChange?: () => void;
}

export function SalesmanFilter({ onBeforeChange }: SalesmanFilterProps) {
  const [salesmanId, setSalesmanId] = useQueryState('salesmanId', parseAsString.withDefault(''));

  // Field staff are one interchangeable pool (see crew-validation.ts's
  // FIELD_STAFF_ROLES) — a DRIVER-role user can be a sheet's salesman too.
  const { data } = useQuery({
    queryKey: ['salesmen', 'dropdown'],
    queryFn: () => usersApi.getAll({ limit: 100, role: 'SALESMAN,DRIVER', isActive: true }).then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });

  const salesmen = (data as { data?: any[] } | undefined)?.data ?? [];

  const handleChange = (v: string) => {
    onBeforeChange?.();
    setSalesmanId(v === 'all' ? null : v);
  };

  return (
    <Select value={salesmanId || 'all'} onValueChange={handleChange}>
      <SelectTrigger className="w-[180px] rounded-xl bg-background/50 border-border/50">
        <SelectValue placeholder="All Salesmen" />
      </SelectTrigger>
      <SelectContent className="rounded-xl border-border/50 shadow-2xl">
        <SelectItem value="all">All Salesmen</SelectItem>
        {salesmen.map((salesman: any) => (
          <SelectItem key={salesman.id} value={salesman.id} className="rounded-lg">
            {salesman.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
