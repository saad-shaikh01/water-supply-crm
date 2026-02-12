import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@water-supply-crm/data-access';
import { setCookie, deleteCookie } from 'cookies-next';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import type { LoginInput } from '../schemas';
import { useAuthStore } from '../../../store/auth.store';

export const useLogin = () => {
  const router = useRouter();
  const queryClient = useQueryClient();
  const setUser = useAuthStore((s) => s.setUser);

  return useMutation({
    mutationFn: async (data: LoginInput) => {
      const response = await apiClient.post('/auth/login', data);
      return response.data;
    },
    onSuccess: (data) => {
      setCookie('auth_token', data.access_token, { maxAge: 60 * 60 * 24 });
      setUser({
        id: data.user.id,
        name: data.user.name,
        email: data.user.email,
        customerId: data.user.customerId,
      });
      queryClient.setQueryData(['auth', 'me'], data.user);
      router.push('/home');
    },
    onError: () => toast.error('Invalid email or password'),
  });
};

export const useLogout = () => {
  const router = useRouter();
  const queryClient = useQueryClient();
  const clearUser = useAuthStore((s) => s.clearUser);

  return () => {
    deleteCookie('auth_token');
    clearUser();
    queryClient.clear();
    router.push('/auth/login');
  };
};
