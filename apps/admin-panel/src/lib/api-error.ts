/**
 * Readable message from an API error. Handles Nest `{ message: string | string[] }`
 * bodies and maps common transport/status failures to friendly text.
 */
export function apiErrorMessage(e: unknown, fallback: string): string {
  const err = e as {
    response?: { status?: number; data?: { message?: string | string[] } };
    code?: string;
    message?: string;
  } | null;

  const m = err?.response?.data?.message;
  if (Array.isArray(m) && m.length) return m.join(' ');
  if (typeof m === 'string' && m) return m;

  const status = err?.response?.status;
  if (status === 401) return 'Your session has expired. Please sign in again.';
  if (status === 403) return 'You do not have permission to perform this action.';
  if (status === 429) return 'Too many requests. Please wait a moment and try again.';
  if (!err?.response && (err?.code === 'ERR_NETWORK' || err?.message === 'Network Error')) {
    return 'Cannot reach the server. Check your connection and try again.';
  }
  return fallback;
}
