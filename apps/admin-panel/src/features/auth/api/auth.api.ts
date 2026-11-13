import axios from 'axios';
import { apiClient, unwrap } from '../../../lib/api';

/**
 * Unauthenticated endpoints use a plain axios instance on purpose: the shared
 * `apiClient` 401 interceptor would otherwise treat a wrong-password 401 as an
 * expired session and hard-redirect, swallowing the error message.
 */
const publicClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000/api',
  headers: { 'Content-Type': 'application/json' },
});

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: string;
  /** Present for SUPER_ADMIN logins only. */
  mustChangePassword?: boolean;
}

export interface LoginResponse {
  access_token: string;
  refresh_token: string;
  user: AuthUser;
}

/** SUPER_ADMIN with 2FA enabled: a second step is required. */
export interface TwoFactorChallenge {
  requires2fa: true;
  challengeToken: string;
}

/** SUPER_ADMIN without 2FA while `security.require2faForSuperAdmin` is on: must enroll first. */
export interface TwoFactorEnrollmentRequired {
  requires2faEnrollment: true;
  enrollmentToken: string;
}

export type LoginResult = LoginResponse | TwoFactorChallenge | TwoFactorEnrollmentRequired;

export interface VerifyTwoFactorResponse extends LoginResponse {
  usedRecoveryCode?: boolean;
  remainingRecoveryCodes?: number;
}

export interface TwoFactorSetup {
  otpauthUri: string;
  qrDataUrl: string;
  /** base32 secret for manual entry */
  secret: string;
}

export interface EnrollConfirmResponse extends LoginResponse {
  recoveryCodes: string[];
}

export const isTwoFactorChallenge = (r: LoginResult): r is TwoFactorChallenge => 'requires2fa' in r && r.requires2fa === true;
export const isEnrollmentRequired = (r: LoginResult): r is TwoFactorEnrollmentRequired =>
  'requires2faEnrollment' in r && r.requires2faEnrollment === true;
export const isLoginTokens = (r: LoginResult): r is LoginResponse => 'access_token' in r;

export const authApi = {
  login: (body: { identifier: string; password: string }) =>
    unwrap<LoginResult>(publicClient.post('/auth/login', body)),
  verifyTwoFactor: (body: { challengeToken: string; code?: string; recoveryCode?: string }) =>
    unwrap<VerifyTwoFactorResponse>(publicClient.post('/auth/2fa/verify', body)),
  enrollStart: (enrollmentToken: string) =>
    unwrap<TwoFactorSetup>(publicClient.post('/auth/2fa/enroll/start', { enrollmentToken })),
  enrollConfirm: (enrollmentToken: string, code: string) =>
    unwrap<EnrollConfirmResponse>(publicClient.post('/auth/2fa/enroll/confirm', { enrollmentToken, code })),
  logout: (refreshToken: string) =>
    unwrap<{ message: string }>(publicClient.post('/auth/logout', { refreshToken })),
  me: () => unwrap<AuthUser>(apiClient.get('/auth/me')),
  changeOwnPassword: (currentPassword: string, newPassword: string) =>
    unwrap<{ message?: string }>(apiClient.patch('/users/me/change-password', { currentPassword, newPassword })),
  forgotPassword: (email: string) =>
    unwrap<{ message: string }>(publicClient.post('/auth/forgot-password', { email })),
  resetPassword: (token: string, newPassword: string) =>
    unwrap<{ message: string }>(publicClient.post('/auth/reset-password', { token, newPassword })),
};
