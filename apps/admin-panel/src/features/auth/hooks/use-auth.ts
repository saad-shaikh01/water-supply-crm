import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getCookie, setCookie } from 'cookies-next';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import type { LoginInput } from '../schemas';
import { useAuthStore } from '../../../store/auth.store';
import {
  authApi,
  isEnrollmentRequired,
  isLoginTokens,
  isTwoFactorChallenge,
  type LoginResponse,
  type LoginResult,
} from '../api/auth.api';
import { apiErrorMessage } from '../../../lib/api-error';
import { clearSession } from '../../../lib/clear-session';

export const ACCESS_DENIED_MESSAGE = 'This panel is for platform administrators only.';

export class AccessDeniedError extends Error {
  constructor() {
    super(ACCESS_DENIED_MESSAGE);
    this.name = 'AccessDeniedError';
  }
}

/**
 * Session cookie flags: `sameSite: 'strict'` always; `secure` on https and in production builds
 * (browsers still accept Secure cookies on localhost over http).
 */
export const cookieOptions = () => ({
  sameSite: 'strict' as const,
  path: '/',
  secure: process.env.NODE_ENV === 'production' || (typeof window !== 'undefined' && window.location.protocol === 'https:'),
});

/** Only platform admins may hold a session here; anything else is revoked and never persisted. */
export async function assertPlatformAdmin(data: LoginResponse): Promise<LoginResponse> {
  if (data.user.role !== 'SUPER_ADMIN') {
    try {
      await authApi.logout(data.refresh_token);
    } catch {
      /* best effort */
    }
    throw new AccessDeniedError();
  }
  return data;
}

export function persistSession(data: LoginResponse, setUser: (u: { id: string; name: string; email: string; role: string }) => void) {
  const opts = cookieOptions();
  setCookie('auth_token', data.access_token, { ...opts, maxAge: 60 * 60 * 24 });
  setCookie('refresh_token', data.refresh_token, { ...opts, maxAge: 60 * 60 * 24 * 7 });
  setCookie('user_role', data.user.role, { ...opts, maxAge: 60 * 60 * 24 * 7 });
  setUser({ id: data.user.id, name: data.user.name, email: data.user.email, role: data.user.role });
}

function handleLoginError(e: unknown) {
  if (e instanceof AccessDeniedError) {
    toast.error(e.message);
    return;
  }
  toast.error(apiErrorMessage(e, 'Unable to sign in. Please try again.'));
}

/**
 * Step 1: email + password. Resolves to tokens (session persisted; navigates to `/` unless the
 * account must change its password first) OR to a 2FA challenge / enrollment requirement, which
 * the login form renders as the next step (no session exists yet in that case).
 */
export const useLogin = () => {
  const router = useRouter();
  const queryClient = useQueryClient();
  const setUser = useAuthStore((s) => s.setUser);

  return useMutation({
    mutationFn: async (input: LoginInput): Promise<LoginResult> => {
      const data = await authApi.login(input);
      if (isTwoFactorChallenge(data) || isEnrollmentRequired(data)) return data;
      return assertPlatformAdmin(data);
    },
    onSuccess: (data) => {
      if (!isLoginTokens(data)) return;
      persistSession(data, setUser);
      queryClient.clear();
      if (!data.user.mustChangePassword) router.replace('/');
    },
    onError: handleLoginError,
  });
};

/** Step 2 (2FA enabled): TOTP code or recovery code against the challenge token. */
export const useVerifyTwoFactor = () => {
  const router = useRouter();
  const queryClient = useQueryClient();
  const setUser = useAuthStore((s) => s.setUser);

  return useMutation({
    mutationFn: async (input: { challengeToken: string; code?: string; recoveryCode?: string }) =>
      assertPlatformAdmin(await authApi.verifyTwoFactor(input)) as Promise<Awaited<ReturnType<typeof authApi.verifyTwoFactor>>>,
    onSuccess: (data) => {
      persistSession(data, setUser);
      queryClient.clear();
      if (data.usedRecoveryCode && typeof data.remainingRecoveryCodes === 'number') {
        toast.warning(`Recovery code used. ${data.remainingRecoveryCodes} remaining.`);
      }
      if (!data.user.mustChangePassword) router.replace('/');
    },
    onError: (e) => {
      if (e instanceof AccessDeniedError) return toast.error(e.message);
      toast.error(apiErrorMessage(e, 'Invalid verification code.'));
    },
  });
};

/** Forced enrollment: start (QR) + confirm (tokens + recovery codes shown once). Caller navigates after "I saved them". */
export const useEnrollTwoFactor = () => {
  const queryClient = useQueryClient();
  const setUser = useAuthStore((s) => s.setUser);

  const start = useMutation({
    mutationFn: (enrollmentToken: string) => authApi.enrollStart(enrollmentToken),
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not start two-factor setup.')),
  });

  const confirm = useMutation({
    mutationFn: async (input: { enrollmentToken: string; code: string }) => {
      const data = await authApi.enrollConfirm(input.enrollmentToken, input.code);
      await assertPlatformAdmin(data);
      return data;
    },
    onSuccess: (data) => {
      persistSession(data, setUser);
      queryClient.clear();
    },
    onError: (e) => {
      if (e instanceof AccessDeniedError) return toast.error(e.message);
      toast.error(apiErrorMessage(e, 'Invalid verification code.'));
    },
  });

  return { start, confirm };
};

/** Forced change of a temporary password (mustChangePassword). Needs the session cookies already set. */
export const useChangeOwnPassword = () =>
  useMutation({
    mutationFn: (input: { currentPassword: string; newPassword: string }) =>
      authApi.changeOwnPassword(input.currentPassword, input.newPassword),
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not change the password.')),
  });

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
