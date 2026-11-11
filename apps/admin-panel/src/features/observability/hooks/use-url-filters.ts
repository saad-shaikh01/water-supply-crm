'use client';

import { useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

export const DEFAULT_LIMIT = 20;

/**
 * Filter + pagination state kept in the URL query string (shareable links).
 * Changing any filter resets `page` to 1; changing only `page`/`limit` keeps filters.
 */
export function useUrlFilters<K extends string>(keys: readonly K[]) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();

  const values = Object.fromEntries(keys.map((k) => [k, search.get(k) ?? ''])) as Record<K, string>;
  const page = Math.max(1, Number(search.get('page')) || 1);
  const limit = Math.min(100, Math.max(1, Number(search.get('limit')) || DEFAULT_LIMIT));

  const write = useCallback(
    (next: URLSearchParams) => {
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname],
  );

  const setFilters = useCallback(
    (patch: Partial<Record<K, string>>) => {
      const next = new URLSearchParams(search.toString());
      for (const [k, v] of Object.entries(patch) as [string, string | undefined][]) {
        if (v) next.set(k, v);
        else next.delete(k);
      }
      next.delete('page');
      write(next);
    },
    [search, write],
  );

  const setPage = useCallback(
    (p: number) => {
      const next = new URLSearchParams(search.toString());
      if (p > 1) next.set('page', String(p));
      else next.delete('page');
      write(next);
    },
    [search, write],
  );

  const setLimit = useCallback(
    (l: number) => {
      const next = new URLSearchParams(search.toString());
      next.set('limit', String(l));
      next.delete('page');
      write(next);
    },
    [search, write],
  );

  const clear = useCallback(() => write(new URLSearchParams()), [write]);

  return { values, page, limit, setFilters, setPage, setLimit, clear };
}

/** Params for the API: drop empty values. */
export function compactParams(obj: Record<string, string | number | undefined | null>) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== '' && v !== undefined && v !== null));
}
