'use client';

import { useQueryState } from 'nuqs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@water-supply-crm/ui';
import { useRoutes } from '../../../features/routes/hooks/use-routes';

export function RouteFilter() {
  const [routeId, setRouteId] = useQueryState('routeId', { defaultValue: '' });
  const { data: routes } = useRoutes();

  return (
    <Select value={routeId || 'all'} onValueChange={(v) => setRouteId(v === 'all' ? null : v)}>
      <SelectTrigger className="w-[180px]">
        <SelectValue placeholder="All Routes" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All Routes</SelectItem>
        {((routes ?? []) as Array<{ id: string; name: string }>).map((route) => (
          <SelectItem key={route.id} value={route.id}>
            {route.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
