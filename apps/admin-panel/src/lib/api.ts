/**
 * API conventions (admin panel)
 * - Each feature has `features/<name>/api/<name>.api.ts` exporting a plain object of
 *   functions that return TYPED DATA (not raw axios responses) - use `unwrap`.
 * - Each feature has `features/<name>/hooks/use-<name>.ts` that uses `queryKeys`.
 * - Mutations invalidate by domain prefix (e.g. `queryKeys.vendors.all`) and toast
 *   failures with `apiErrorMessage`.
 */
import type { AxiosResponse } from 'axios';
import { apiClient } from '@water-supply-crm/data-access';

export { apiClient };

export async function unwrap<T>(p: Promise<AxiosResponse<T>>): Promise<T> {
  return (await p).data;
}
