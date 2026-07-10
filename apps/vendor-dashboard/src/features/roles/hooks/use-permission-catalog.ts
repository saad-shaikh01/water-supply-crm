import { useQuery } from '@tanstack/react-query';
import { permissionsApi } from '../api/permissions.api';
import { queryKeys } from '../../../lib/query-keys';

/**
 * The frozen permission catalog (`GET /permissions`), grouped by resource exactly as the
 * backend returns it — never hardcode a permission list on the frontend. Long `staleTime`
 * since the catalog only changes on deploy, not per-request.
 */
export const usePermissionCatalog = () =>
  useQuery({
    queryKey: queryKeys.permissions.catalog(),
    queryFn: () => permissionsApi.getCatalog().then((r) => r.data.groups),
    staleTime: Infinity,
  });
