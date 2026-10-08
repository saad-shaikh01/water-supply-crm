import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { brandingApi } from '../api/branding.api';

/**
 * The signed-in customer's vendor brand. Signed logo URLs live 15 min, so the query is refreshed a bit
 * sooner. While it loads (or if it fails) callers must NOT guess a brand — showing another business's
 * logo to a customer is exactly the bug this exists to prevent.
 */
export const usePortalBranding = () => {
  const query = useQuery({
    queryKey: ['portal-branding'],
    queryFn: () => brandingApi.get().then((r) => r.data),
    staleTime: 10 * 60_000,
    refetchInterval: 12 * 60_000,
  });

  const name = query.data?.name;
  useEffect(() => {
    if (name) document.title = `${name} — Customer Portal`;
  }, [name]);

  return query;
};
