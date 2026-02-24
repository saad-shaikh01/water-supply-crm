'use client';

import { useQueryState, parseAsString } from 'nuqs';
import { useQuery } from '@tanstack/react-query';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@water-supply-crm/ui';
import { usersApi } from '../../../features/users/api/users.api';

interface DriverFilterProps {
  onBeforeChange?: () => void;
}

export function DriverFilter({ onBeforeChange }: DriverFilterProps) {
  const [driverId, setDriverId] = useQueryState('driverId', parseAsString.withDefault(''));

  const { data } = useQuery({
    queryKey: ['drivers', 'dropdown'],
    queryFn: () => usersApi.getAll({ limit: 100, role: 'DRIVER', isActive: true }).then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });

  const drivers = (data as { data?: any[] } | undefined)?.data ?? [];

  const handleChange = (v: string) => {
    onBeforeChange?.();
    setDriverId(v === 'all' ? null : v);
  };

  return (
    <Select value={driverId || 'all'} onValueChange={handleChange}>
      <SelectTrigger className="w-[180px] rounded-xl bg-background/50 border-border/50">
        <SelectValue placeholder="All Drivers" />
      </SelectTrigger>
      <SelectContent className="rounded-xl border-border/50 shadow-2xl">
        <SelectItem value="all">All Drivers</SelectItem>
        {drivers.map((driver: any) => (
          <SelectItem key={driver.id} value={driver.id} className="rounded-lg">
            {driver.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
