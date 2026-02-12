import { useQuery } from '@tanstack/react-query';
import { profileApi } from '../api/profile.api';
import { useAuthStore } from '../../../store/auth.store';
import { queryKeys } from '../../../lib/query-keys';

export const useProfile = () => {
  const user = useAuthStore((s) => s.user);

  return useQuery({
    queryKey: queryKeys.customer.profile(user?.customerId ?? ''),
    queryFn: () => profileApi.getProfile(user!.customerId).then((r) => r.data),
    enabled: !!user?.customerId,
  });
};
