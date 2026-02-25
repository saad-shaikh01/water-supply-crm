import { useMutation, useQueryClient } from '@tanstack/react-query';
import { setCookie, deleteCookie, getCookie } from 'cookies-next';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { authApi } from '../api/auth.api';
import { useAuthStore } from '../../../store/auth.store';
import type { LoginInput } from '../schemas';

export const useLogin = () => {
  const router = useRouter();
  const queryClient = useQueryClient();
  const setUser = useAuthStore((s) => s.setUser);

  return useMutation({
    mutationFn: (data: LoginInput) => authApi.login(data),
    onSuccess: ({ data }) => {
      setCookie('auth_token', data.access_token, { maxAge: 60 * 60 * 24 });       // 1 day
      setCookie('refresh_token', data.refresh_token, { maxAge: 60 * 60 * 24 * 7 }); // 7 days
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
    const refreshToken = getCookie('refresh_token') as string | undefined;
    if (refreshToken) {
      authApi.logout(refreshToken).catch(() => null);
    }
    deleteCookie('auth_token');
    deleteCookie('refresh_token');
    clearUser();
    queryClient.clear();
    router.push('/auth/login');
  };
};
