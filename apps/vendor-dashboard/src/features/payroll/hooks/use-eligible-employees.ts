import { useQuery } from '@tanstack/react-query';
import { usersApi } from '../../users/api/users.api';
import { queryKeys } from '../../../lib/query-keys';
import { PAYROLL_ELIGIBLE_ROLES } from '../constants';

export interface EligibleEmployee {
  id: string;
  name: string;
  email: string;
  role: string;
}

/**
 * Active staff/driver/salesman/loader users — the payroll-eligible population
 * (mirrors `PAYROLL_ELIGIBLE_ROLES` in `payroll-entry.service.ts`). `GET /users`
 * only filters by a single `role`, not a set, so the eligible roles are filtered
 * client-side out of one active-users page — acceptable at this app's staff scale.
 */
export const useEligibleEmployees = () => {
  return useQuery({
    queryKey: queryKeys.payroll.eligibleEmployees(),
    queryFn: async (): Promise<EligibleEmployee[]> => {
      const res = await usersApi.getAll({ limit: 100, isActive: true });
      const body = res.data as { data?: EligibleEmployee[] };
      const users = body?.data ?? [];
      return users.filter((u) => (PAYROLL_ELIGIBLE_ROLES as readonly string[]).includes(u.role));
    },
  });
};
