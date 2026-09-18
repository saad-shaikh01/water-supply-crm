import { create } from 'zustand';
import { AxiosHeaders, type InternalAxiosRequestConfig } from 'axios';
import { LOCK_OVERRIDE_HEADER, type PeriodClosedErrorBody } from '../api/van-cash-ledger.api';

/**
 * Accounting-period override (P4) — client-side state + the pure decision logic
 * behind the global axios interceptor (see `lock-override-provider.tsx`).
 *
 * A write into a CLOSED period is rejected by the server with a 403 carrying
 * `code: 'PERIOD_CLOSED'`. When the caller may override (`canOverride`), the
 * interceptor asks for a reason via ONE dialog (requests are queued, never
 * stacked) and replays the same request with the `X-Lock-Override-Reason` header.
 */

/** Minimum reason length (trimmed) — mirrors the server contract. */
export const OVERRIDE_REASON_MIN = 10;
/** Server caps the header at 500 chars. */
export const OVERRIDE_REASON_MAX = 500;

/** Flag set on the replayed request's config so it is never prompted / retried twice. */
export const OVERRIDE_RETRIED_FLAG = '_lockOverrideRetried';

// ── Pure helpers (unit-tested) ──────────────────────────────────────────────

type OverrideConfig = InternalAxiosRequestConfig & { [OVERRIDE_RETRIED_FLAG]?: boolean };

interface MaybeAxiosError {
  config?: OverrideConfig;
  response?: { data?: unknown };
}

const hasOverrideHeader = (config: OverrideConfig): boolean => {
  const headers = config.headers as unknown;
  if (!headers) return false;
  if (typeof (headers as AxiosHeaders).has === 'function') return (headers as AxiosHeaders).has(LOCK_OVERRIDE_HEADER);
  const lower = LOCK_OVERRIDE_HEADER.toLowerCase();
  return Object.keys(headers as Record<string, unknown>).some((k) => k.toLowerCase() === lower);
};

/**
 * True when `error` is an overridable PERIOD_CLOSED rejection that has NOT been
 * replayed yet. Non-overridable closed-period errors and every other error
 * (401s, validation, …) return false and pass through untouched.
 */
export function shouldPromptOverride(error: unknown): error is MaybeAxiosError & { config: OverrideConfig } {
  const err = error as MaybeAxiosError | null | undefined;
  const body = err?.response?.data as Partial<PeriodClosedErrorBody> | undefined;
  if (!err?.config || !body || body.code !== 'PERIOD_CLOSED' || body.canOverride !== true) return false;
  if (err.config[OVERRIDE_RETRIED_FLAG]) return false;
  if (hasOverrideHeader(err.config)) return false;
  return true;
}

/**
 * Normalises the typed reason: control characters / newlines become a space
 * (1:1, so the length the user counted is the length the server sees), then trim
 * and cap. Unicode is kept as-is — the header carries it percent-encoded.
 */
export function sanitizeOverrideReason(raw: string): string {
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, OVERRIDE_REASON_MAX);
}

/**
 * Header values must be ASCII (XHR rejects code points above Latin-1), so the reason
 * (which may be Urdu script, ₨ or emoji) is sent percent-encoded; the server's
 * LockOverrideMiddleware decodes it and still accepts a plain ASCII value.
 */
export function encodeOverrideHeaderValue(reason: string): string {
  return encodeURIComponent(sanitizeOverrideReason(reason));
}

/**
 * Builds the config for replaying the failed request with the override header.
 * `config.data` on a failed request is ALREADY serialised (JSON string) or a
 * FormData — it is passed through untouched (axios leaves a valid JSON string
 * as-is on the second transform). Headers are copied, never mutated in place.
 */
export function buildOverrideRetryConfig(config: InternalAxiosRequestConfig, reason: string): OverrideConfig {
  const headers = new AxiosHeaders(config.headers as AxiosHeaders);
  headers.set(LOCK_OVERRIDE_HEADER, encodeOverrideHeaderValue(reason));
  return { ...config, headers, [OVERRIDE_RETRIED_FLAG]: true };
}

// ── Queue + store ───────────────────────────────────────────────────────────

export interface OverridePrompt {
  periods: string[];
  message: string;
}

interface QueuedPrompt extends OverridePrompt {
  id: number;
  /** Resolves with the sanitised reason, or null when the user cancelled. */
  settle: (reason: string | null) => void;
}

interface LockOverrideState {
  /** FIFO — the head is the one dialog on screen; the rest wait their turn. */
  queue: QueuedPrompt[];
  /** Resolves with the reason, or `null` on cancel. Never rejects. */
  requestOverride: (prompt: OverridePrompt) => Promise<string | null>;
  /** Settles the head of the queue (the visible dialog) and reveals the next. */
  resolveActive: (reason: string | null) => void;
  /** Cancels every pending prompt (provider unmounted) so no request hangs. */
  cancelAll: () => void;
}

let nextId = 1;

export const useLockOverrideStore = create<LockOverrideState>()((set, get) => ({
  queue: [],
  requestOverride: (prompt) =>
    new Promise<string | null>((resolve) => {
      set((s) => ({ queue: [...s.queue, { ...prompt, id: nextId++, settle: resolve }] }));
    }),
  resolveActive: (reason) => {
    const [head, ...rest] = get().queue;
    if (!head) return;
    set({ queue: rest });
    head.settle(reason);
  },
  cancelAll: () => {
    const pending = get().queue;
    set({ queue: [] });
    pending.forEach((p) => p.settle(null));
  },
}));

/** Outside React (the axios interceptor). */
export const requestOverride = (prompt: OverridePrompt): Promise<string | null> =>
  useLockOverrideStore.getState().requestOverride(prompt);
