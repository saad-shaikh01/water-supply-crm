import { AxiosHeaders, type InternalAxiosRequestConfig } from 'axios';
import { LOCK_OVERRIDE_HEADER } from '../api/van-cash-ledger.api';
import {
  OVERRIDE_RETRIED_FLAG, buildOverrideRetryConfig, encodeOverrideHeaderValue, sanitizeOverrideReason, shouldPromptOverride, useLockOverrideStore,
} from './lock-override-store';

const config = (extra: Record<string, unknown> = {}) =>
  ({
    url: '/van-cash-ledger/manual-cash-in',
    method: 'post',
    data: '{"amount":500}',
    headers: new AxiosHeaders({ 'Content-Type': 'application/json', Authorization: 'Bearer t' }),
    ...extra,
  }) as unknown as InternalAxiosRequestConfig;

const closedError = (over: Record<string, unknown> = {}, cfg = config()) => ({
  config: cfg,
  response: {
    status: 403,
    data: { statusCode: 403, code: 'PERIOD_CLOSED', message: 'Closed', periods: ['2026-08'], canOverride: true, ...over },
  },
});

describe('shouldPromptOverride', () => {
  it('prompts for an overridable PERIOD_CLOSED error', () => {
    expect(shouldPromptOverride(closedError())).toBe(true);
  });
  it('passes non-overridable, other codes, and non-axios errors through', () => {
    expect(shouldPromptOverride(closedError({ canOverride: false }))).toBe(false);
    expect(shouldPromptOverride(closedError({ code: 'FORBIDDEN' }))).toBe(false);
    expect(shouldPromptOverride({ config: config(), response: { status: 401, data: {} } })).toBe(false);
    expect(shouldPromptOverride(new Error('network'))).toBe(false);
    expect(shouldPromptOverride(undefined)).toBe(false);
  });
  it('never prompts a replay (flag or header already present)', () => {
    expect(shouldPromptOverride(closedError({}, config({ [OVERRIDE_RETRIED_FLAG]: true })))).toBe(false);
    const withHeader = config();
    withHeader.headers.set(LOCK_OVERRIDE_HEADER, 'some reason here');
    expect(shouldPromptOverride(closedError({}, withHeader))).toBe(false);
  });
});

describe('buildOverrideRetryConfig', () => {
  it('adds the header on a COPY, keeps serialised data untouched and flags the retry', () => {
    const original = config();
    const retry = buildOverrideRetryConfig(original, 'Fuel receipt entered late');
    expect(retry.data).toBe('{"amount":500}');
    expect(retry[OVERRIDE_RETRIED_FLAG]).toBe(true);
    expect(new AxiosHeaders(retry.headers).get(LOCK_OVERRIDE_HEADER)).toBe(encodeURIComponent('Fuel receipt entered late'));
    expect(new AxiosHeaders(retry.headers).get('Authorization')).toBe('Bearer t');
    expect(original.headers.has(LOCK_OVERRIDE_HEADER)).toBe(false);
  });
  it('passes FormData through untouched', () => {
    const form = new FormData();
    const retry = buildOverrideRetryConfig(config({ data: form }), 'a valid reason');
    expect(retry.data).toBe(form);
  });
});

describe('sanitizeOverrideReason', () => {
  it('flattens control characters 1:1, keeps Unicode, trims and caps', () => {
    expect(sanitizeOverrideReason('  line one\nline two  ')).toBe('line one line two');
    expect(sanitizeOverrideReason('rupees \u20a8 ok')).toBe('rupees \u20a8 ok');
    expect(sanitizeOverrideReason('x'.repeat(600))).toHaveLength(500);
  });
});

describe('encodeOverrideHeaderValue', () => {
  it('is pure ASCII and round-trips Unicode reasons through decodeURIComponent', () => {
    const reason = '\u063a\u0644\u0637 \u0627\u0646\u062f\u0631\u0627\u062c \u2014 \u20a8 500 fix';
    const encoded = encodeOverrideHeaderValue(reason);
    expect(/^[\x20-\x7e]*$/.test(encoded)).toBe(true);
    expect(decodeURIComponent(encoded)).toBe(reason);
  });
});

describe('override queue', () => {
  beforeEach(() => useLockOverrideStore.getState().cancelAll());

  it('shows one prompt at a time, in order, and settles each independently', async () => {
    const { requestOverride, resolveActive } = useLockOverrideStore.getState();
    const first = requestOverride({ periods: ['2026-08'], message: 'a' });
    const second = requestOverride({ periods: ['2026-07'], message: 'b' });
    expect(useLockOverrideStore.getState().queue.map((q) => q.message)).toEqual(['a', 'b']);

    resolveActive('reason for first');
    await expect(first).resolves.toBe('reason for first');
    expect(useLockOverrideStore.getState().queue[0].message).toBe('b');

    resolveActive(null);
    await expect(second).resolves.toBeNull();
    expect(useLockOverrideStore.getState().queue).toHaveLength(0);
  });

  it('cancelAll resolves every pending prompt with null', async () => {
    const p = useLockOverrideStore.getState().requestOverride({ periods: [], message: 'x' });
    useLockOverrideStore.getState().cancelAll();
    await expect(p).resolves.toBeNull();
  });
});
