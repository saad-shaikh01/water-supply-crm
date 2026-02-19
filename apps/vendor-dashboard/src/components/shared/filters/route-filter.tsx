'use client';

import { useQueryState, parseAsString } from 'nuqs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@water-supply-crm/ui';
import { useRoutes } from '../../../features/routes/hooks/use-routes';

export function RouteFilter() {
  const [routeId, setRouteId] = useQueryState('routeId', parseAsString.withDefault(''));
  const { data } = useRoutes();

  const routes = (data as { data?: any[] } | undefined)?.data ?? [];

  return (
    <Select value={routeId || 'all'} onValueChange={(v) => setRouteId(v === 'all' ? null : v)}>
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
