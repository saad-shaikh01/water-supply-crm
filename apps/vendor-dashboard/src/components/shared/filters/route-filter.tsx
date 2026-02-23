'use client';

import { useQueryState, parseAsString } from 'nuqs';
import { useQuery } from '@tanstack/react-query';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@water-supply-crm/ui';
import { routesApi } from '../../../features/routes/api/routes.api';

interface RouteFilterProps {
  onBeforeChange?: () => void;
}

export function RouteFilter({ onBeforeChange }: RouteFilterProps) {
  const [routeId, setRouteId] = useQueryState('routeId', parseAsString.withDefault(''));

  // Fixed params — NOT URL state — avoids collision with list's page param
  const { data } = useQuery({
    queryKey: ['routes', 'dropdown'],
    queryFn: () => routesApi.getAll({ page: 1, limit: 100 }).then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });

  const routes = (data as { data?: any[] } | undefined)?.data ?? [];

  const handleChange = (v: string) => {
    onBeforeChange?.();
    setRouteId(v === 'all' ? null : v);
  };

  return (
    <Select value={routeId || 'all'} onValueChange={handleChange}>
      <SelectTrigger className="w-[180px] rounded-xl bg-background/50 border-border/50">
        <SelectValue placeholder="All Routes" />
      </SelectTrigger>
      <SelectContent className="rounded-xl border-border/50 shadow-2xl">
        <SelectItem value="all">All Routes</SelectItem>
        {routes.map((route: any) => (
          <SelectItem key={route.id} value={route.id} className="rounded-lg">
            {route.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
