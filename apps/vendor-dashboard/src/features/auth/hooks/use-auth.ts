import { useMutation, useQueryClient } from '@tanstack/react-query';
import { setCookie, deleteCookie, getCookie } from 'cookies-next';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { authApi } from '../api/auth.api';
import { useAuthStore } from '../../../store/auth.store';
import { queryKeys } from '../../../lib/query-keys';
import type { LoginInput } from '../schemas';
import type { Role } from '../../../lib/rbac';

export const useLogin = () => {
  const router = useRouter();
  const setUser = useAuthStore((s) => s.setUser);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: LoginInput) => authApi.login(data),
    onSuccess: ({ data }) => {
      setCookie('auth_token', data.access_token, { maxAge: 60 * 60 * 24 });       // 1 day
      setCookie('refresh_token', data.refresh_token, { maxAge: 60 * 60 * 24 * 7 }); // 7 days
      setCookie('user_role', data.user.role, { maxAge: 60 * 60 * 24 * 7 });
      setUser({ ...data.user, role: data.user.role as Role });
      queryClient.setQueryData(queryKeys.auth.me, data.user);
      if (data.user.role === 'DRIVER') {
        router.push('/dashboard/home');
      } else {
        router.push('/dashboard/overview');
      }
    },
    onError: () => {
      toast.error('Invalid email or password');
    },
  });
};

export const useLogout = () => {
  const router = useRouter();
  const clearUser = useAuthStore((s) => s.clearUser);
  const queryClient = useQueryClient();

  return () => {
    const refreshToken = getCookie('refresh_token') as string | undefined;
    // Fire-and-forget: invalidate refresh token in Redis
    if (refreshToken) {
      authApi.logout(refreshToken).catch(() => null);
    }
    deleteCookie('auth_token');
    deleteCookie('refresh_token');
    deleteCookie('user_role');
    clearUser();
    queryClient.clear();
    router.push('/auth/login');
  };
};

export const useForgotPassword = () => {
  return useMutation({
    mutationFn: (email: string) => authApi.forgotPassword(email),
    onSuccess: () => {
      toast.success('Password reset email sent. Check your inbox.');
    },
    onError: () => {
      toast.error('Failed to send reset email. Please try again.');
    },
  });
};

export const useResetPassword = () => {
  const router = useRouter();

  return useMutation({
    mutationFn: ({ token, password }: { token: string; password: string }) =>
      authApi.resetPassword(token, password),
    onSuccess: () => {
      toast.success('Password reset successfully!');
      router.push('/auth/login');
    },
    onError: () => {
      toast.error('Failed to reset password. Token may be expired.');
    },
  });
};
