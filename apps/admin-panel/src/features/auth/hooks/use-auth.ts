import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getCookie, setCookie } from 'cookies-next';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import type { LoginInput } from '../schemas';
import { useAuthStore } from '../../../store/auth.store';
import { authApi } from '../api/auth.api';
import { apiErrorMessage } from '../../../lib/api-error';
import { clearSession } from '../../../lib/clear-session';

export const ACCESS_DENIED_MESSAGE = 'This panel is for platform administrators only.';

export class AccessDeniedError extends Error {
  constructor() {
    super(ACCESS_DENIED_MESSAGE);
    this.name = 'AccessDeniedError';
  }
}

const cookieOptions = () => ({
  sameSite: 'lax' as const,
  secure: typeof window !== 'undefined' && window.location.protocol === 'https:',
});

export const useLogin = () => {
  const router = useRouter();
  const queryClient = useQueryClient();
  const setUser = useAuthStore((s) => s.setUser);

  return useMutation({
    mutationFn: async (input: LoginInput) => {
      const data = await authApi.login(input);
      if (data.user.role !== 'SUPER_ADMIN') {
        // Revoke the refresh token that was just minted; never persist anything.
        try {
          await authApi.logout(data.refresh_token);
        } catch {
          /* best effort */
        }
        throw new AccessDeniedError();
      }
      return data;
    },
    onSuccess: (data) => {
      const opts = cookieOptions();
      setCookie('auth_token', data.access_token, { ...opts, maxAge: 60 * 60 * 24 });
      setCookie('refresh_token', data.refresh_token, { ...opts, maxAge: 60 * 60 * 24 * 7 });
      setCookie('user_role', data.user.role, { ...opts, maxAge: 60 * 60 * 24 * 7 });
      setUser({ id: data.user.id, name: data.user.name, email: data.user.email, role: data.user.role });
      queryClient.clear();
      router.replace('/');
    },
    onError: (e) => {
      if (e instanceof AccessDeniedError) {
        toast.error(e.message);
        return;
      }
      toast.error(apiErrorMessage(e, 'Unable to sign in. Please try again.'));
    },
  });
};

/** Revoke server-side (fire and forget), wipe local state, go to login. */
export const useLogout = () => {
  const router = useRouter();
  const queryClient = useQueryClient();

  return () => {
    const refreshToken = getCookie('refresh_token');
    if (typeof refreshToken === 'string' && refreshToken) {
      authApi.logout(refreshToken).catch(() => undefined);
    }
    clearSession();
    queryClient.clear();
    router.replace('/auth/login');
  };
};
