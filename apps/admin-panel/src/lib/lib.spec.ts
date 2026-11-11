import { apiErrorMessage } from './api-error';
import { formatCurrency, formatNumber, formatPercent } from './format';
import { queryKeys } from './query-keys';

describe('apiErrorMessage', () => {
  it('joins array messages', () => {
    expect(apiErrorMessage({ response: { data: { message: ['a', 'b'] } } }, 'fb')).toBe('a b');
  });
  it('uses string message', () => {
    expect(apiErrorMessage({ response: { data: { message: 'Account temporarily locked' } } }, 'fb')).toBe('Account temporarily locked');
  });
  it('falls back', () => {
    expect(apiErrorMessage(undefined, 'fb')).toBe('fb');
    expect(apiErrorMessage({ response: { status: 500 } }, 'fb')).toBe('fb');
  });
  it('maps network errors', () => {
    expect(apiErrorMessage({ code: 'ERR_NETWORK', message: 'Network Error' }, 'fb')).toBe(
      'Cannot reach the server. Check your connection and try again.',
    );
  });
});

describe('format', () => {
  it('formats currency and numbers null-safely', () => {
    expect(formatCurrency(1234567)).toBe('Rs. 1,234,567');
    expect(formatCurrency(null)).toBe('Rs. 0');
    expect(formatNumber(undefined)).toBe('0');
    expect(formatNumber(NaN)).toBe('0');
  });
  it('formats percent', () => {
    expect(formatPercent(12)).toBe('+12%');
    expect(formatPercent(-5)).toBe('-5%');
    expect(formatPercent(0)).toBe('0%');
    expect(formatPercent(null)).toBe('0%');
  });
});

describe('queryKeys', () => {
  it('list/detail keys are prefix-compatible with all', () => {
    expect(queryKeys.vendors.list({ page: 1 }).slice(0, 1)).toEqual([...queryKeys.vendors.all]);
    expect(queryKeys.vendors.detail('x')[0]).toBe('vendors');
    expect(queryKeys.dashboard.platform[0]).toBe(queryKeys.dashboard.all[0]);
  });
  it('is stable for equal params', () => {
    expect(queryKeys.vendors.list({ page: 1, limit: 5 })).toEqual(queryKeys.vendors.list({ page: 1, limit: 5 }));
  });
});
