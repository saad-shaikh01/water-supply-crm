import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { profileApi } from '../api/profile.api';

export const useProfile = () =>
  useQuery({
    queryKey: ['portal-me'],
    queryFn: () => profileApi.getProfile().then((r) => r.data),
  });

export const useChangePassword = () =>
  useMutation({
    mutationFn: profileApi.changePassword,
    onSuccess: () => toast.success('Password updated successfully'),
    onError: (e: any) =>
      toast.error(e?.response?.data?.message ?? 'Failed to update password'),
  });
