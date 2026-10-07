import { isSlipEligibleStatus, slipChip, slipDisabledReason, SLIP_ELIGIBLE_STATUSES } from './salary-slips';
import type { SlipEntryStatus } from '../api/payroll.api';

describe('slip eligibility (mirrors the backend)', () => {
  it.each(['APPROVED', 'LOCKED', 'SETTLED'])('%s is eligible with no disabled reason', (status) => {
    expect(isSlipEligibleStatus(status)).toBe(true);
    expect(slipDisabledReason(status)).toBeNull();
  });

  it.each(['DRAFT', 'UNDER_REVIEW', 'WHATEVER'])('%s is NOT eligible and says why', (status) => {
    expect(isSlipEligibleStatus(status)).toBe(false);
    expect(slipDisabledReason(status)).toMatch(/approve this entry first/i);
  });

  it('the eligible list is exactly the three final states', () => {
    expect([...SLIP_ELIGIBLE_STATUSES]).toEqual(['APPROVED', 'LOCKED', 'SETTLED']);
  });
});

describe('slipChip', () => {
  const st = (over: Partial<SlipEntryStatus>): SlipEntryStatus => ({ last: null, lastSent: null, ...over });

  it('is null when no slip was ever attempted', () => {
    expect(slipChip(undefined)).toBeNull();
    expect(slipChip(st({}))).toBeNull();
  });

  it('QUEUED → "Sending…"', () => {
    expect(slipChip(st({ last: { status: 'QUEUED', error: null, at: '2026-10-07T10:00:00Z' } }))).toEqual({ label: 'Sending…', tone: 'info' });
  });

  it('SENT → ok chip; amount changed since → warn chip', () => {
    const last = { status: 'SENT' as const, error: null, at: '2026-10-07T10:00:00Z' };
    expect(slipChip(st({ last, lastSent: { at: last.at, finalPayable: 100, amountChanged: false } }))).toMatchObject({ tone: 'ok', label: expect.stringMatching(/^Slip sent/) });
    expect(slipChip(st({ last, lastSent: { at: last.at, finalPayable: 100, amountChanged: true } }))).toMatchObject({ tone: 'warn', label: expect.stringContaining('amount changed') });
  });

  it.each([
    ['FAILED', 'Slip failed'],
    ['SKIPPED_NO_PHONE', 'No phone'],
    ['SKIPPED_DISCONNECTED', 'Not sent (WhatsApp offline)'],
  ] as const)('%s → bad chip "%s" carrying the error as a tooltip', (status, label) => {
    const chip = slipChip(st({ last: { status, error: 'boom', at: '2026-10-07T10:00:00Z' } }));
    expect(chip).toMatchObject({ tone: 'bad', title: 'boom' });
    expect(chip?.label.startsWith(label)).toBe(true);
  });

  it('a failure after an earlier successful send mentions the earlier send', () => {
    const chip = slipChip(
      st({
        last: { status: 'FAILED', error: null, at: '2026-10-08T10:00:00Z' },
        lastSent: { at: '2026-10-07T10:00:00Z', finalPayable: 1, amountChanged: false },
      }),
    );
    expect(chip?.label).toContain('sent earlier');
  });
});
