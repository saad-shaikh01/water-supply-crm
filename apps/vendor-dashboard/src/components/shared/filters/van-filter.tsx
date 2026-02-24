'use client';

import { useQueryState, parseAsString } from 'nuqs';
import { useQuery } from '@tanstack/react-query';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@water-supply-crm/ui';
import { vansApi } from '../../../features/vans/api/vans.api';

interface VanFilterProps {
  onBeforeChange?: () => void;
}

export function VanFilter({ onBeforeChange }: VanFilterProps) {
  const [vanId, setVanId] = useQueryState('vanId', parseAsString.withDefault(''));

  const { data } = useQuery({
    queryKey: ['vans', 'dropdown'],
    queryFn: () => vansApi.getAll({ page: 1, limit: 100 }).then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });

  const vans = (data as { data?: any[] } | undefined)?.data ?? [];

  const handleChange = (v: string) => {
    onBeforeChange?.();
    setVanId(v === 'all' ? null : v);
  };

  return (
    <Select value={vanId || 'all'} onValueChange={handleChange}>
      <SelectTrigger className="w-[180px] rounded-xl bg-background/50 border-border/50">
        <SelectValue placeholder="All Vans" />
      </SelectTrigger>
      <SelectContent className="rounded-xl border-border/50 shadow-2xl">
        <SelectItem value="all">All Vans</SelectItem>
        {vans.map((van: any) => (
          <SelectItem key={van.id} value={van.id} className="rounded-lg">
            {van.plateNumber}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
