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
}

export interface LoginResponse {
  access_token: string;
  refresh_token: string;
  user: AuthUser;
}

export const authApi = {
  login: (body: { identifier: string; password: string }) =>
    unwrap<LoginResponse>(publicClient.post('/auth/login', body)),
  logout: (refreshToken: string) =>
    unwrap<{ message: string }>(publicClient.post('/auth/logout', { refreshToken })),
  me: () => unwrap<AuthUser>(apiClient.get('/auth/me')),
  forgotPassword: (email: string) =>
    unwrap<{ message: string }>(publicClient.post('/auth/forgot-password', { email })),
  resetPassword: (token: string, newPassword: string) =>
    unwrap<{ message: string }>(publicClient.post('/auth/reset-password', { token, newPassword })),
};
