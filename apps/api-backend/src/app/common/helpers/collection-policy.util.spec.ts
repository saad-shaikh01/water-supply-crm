import { evaluateCollectionPolicy } from './collection-policy.util';
import type { CollectionPolicy } from '@water-supply-crm/types';

describe('evaluateCollectionPolicy', () => {
  const POLICY: CollectionPolicy = {
    enabled: true,
    minOutstandingThreshold: 1000,
    minCollectionPercentage: 90,
    allowedShortfall: 300,
  };

  const baseInput = {
    paymentType: 'MONTHLY' as const,
    isBillingExempt: false,
    remainingPreviousOutstanding: 2000,
    cashCollected: 0,
  };

  // ── Exemptions (applies = false) ─────────────────────────────────────────

  it('is exempt when the policy is disabled', () => {
    const result = evaluateCollectionPolicy(
      { ...POLICY, enabled: false },
      { ...baseInput, cashCollected: 1 },
    );
    expect(result).toEqual({
      applies: false,
      satisfied: true,
      reason: 'DISABLED',
      requiredAmount: 0,
      collectedAmount: 1,
      remainingPreviousOutstanding: 2000,
    });
  });

  it('is exempt for CASH-type customers', () => {
    const result = evaluateCollectionPolicy(POLICY, {
      ...baseInput,
      paymentType: 'CASH',
      cashCollected: 1,
    });
    expect(result.applies).toBe(false);
    expect(result.reason).toBe('NOT_MONTHLY');
  });

  it('is exempt for billing-exempt monthly customers', () => {
    const result = evaluateCollectionPolicy(POLICY, {
      ...baseInput,
      isBillingExempt: true,
      cashCollected: 1,
    });
    expect(result.applies).toBe(false);
    expect(result.reason).toBe('BILLING_EXEMPT');
  });

  it('is exempt when remaining previous outstanding is below the threshold', () => {
    const result = evaluateCollectionPolicy(POLICY, {
      ...baseInput,
      remainingPreviousOutstanding: 999,
      cashCollected: 1,
    });
    expect(result.applies).toBe(false);
    expect(result.reason).toBe('BELOW_THRESHOLD');
  });

  it('is exempt (ZERO_CASH) when cash collected is 0, even above threshold', () => {
    const result = evaluateCollectionPolicy(POLICY, {
      ...baseInput,
      remainingPreviousOutstanding: 2000,
      cashCollected: 0,
    });
    expect(result).toEqual({
      applies: false,
      satisfied: true,
      reason: 'ZERO_CASH',
      requiredAmount: 0,
      collectedAmount: 0,
      remainingPreviousOutstanding: 2000,
    });
  });

  it('reports BELOW_THRESHOLD rather than ZERO_CASH when both conditions hold', () => {
    // Below-threshold takes precedence: the audit-log gate in submitDelivery relies
    // on ZERO_CASH meaning "a real collection opportunity was skipped", which is
    // only true when the remaining outstanding actually met the threshold.
    const result = evaluateCollectionPolicy(POLICY, {
      ...baseInput,
      remainingPreviousOutstanding: 500,
      cashCollected: 0,
    });
    expect(result.reason).toBe('BELOW_THRESHOLD');
  });

  it('negative remainingPreviousOutstanding is floored at 0 before evaluation', () => {
    const result = evaluateCollectionPolicy(POLICY, {
      ...baseInput,
      remainingPreviousOutstanding: -500,
      cashCollected: 1,
    });
    expect(result.remainingPreviousOutstanding).toBe(0);
    expect(result.reason).toBe('BELOW_THRESHOLD');
  });

  // ── Minimum-only enforcement (the locked business rule) ──────────────────

  describe('the product owner\'s worked example: remaining=500, 90%, shortfall=50 -> required=400', () => {
    const policy: CollectionPolicy = {
      enabled: true,
      minOutstandingThreshold: 500,
      minCollectionPercentage: 90,
      allowedShortfall: 50,
    };
    const input = { ...baseInput, remainingPreviousOutstanding: 500 };

    it('computes requiredAmount = 400', () => {
      const result = evaluateCollectionPolicy(policy, { ...input, cashCollected: 400 });
      expect(result.requiredAmount).toBe(400);
    });

    it.each([400, 450, 500, 700, 1000])(
      'cashCollected=%d is valid (no upper bound)',
      (cashCollected) => {
        const result = evaluateCollectionPolicy(policy, { ...input, cashCollected });
        expect(result.applies).toBe(true);
        expect(result.satisfied).toBe(true);
        expect(result.reason).toBeUndefined();
      },
    );

    it.each([1, 100, 399])('cashCollected=%d is invalid (below the minimum)', (cashCollected) => {
      const result = evaluateCollectionPolicy(policy, { ...input, cashCollected });
      expect(result.applies).toBe(true);
      expect(result.satisfied).toBe(false);
      expect(result.reason).toBe('BELOW_MINIMUM');
      expect(result.requiredAmount).toBe(400);
    });

    it('an exact-boundary payment (400) satisfies the policy (>= not >)', () => {
      const result = evaluateCollectionPolicy(policy, { ...input, cashCollected: 400 });
      expect(result.satisfied).toBe(true);
    });
  });

  it('requiredAmount never goes negative even with a large allowedShortfall', () => {
    const policy: CollectionPolicy = {
      enabled: true,
      minOutstandingThreshold: 100,
      minCollectionPercentage: 50,
      allowedShortfall: 10000,
    };
    const result = evaluateCollectionPolicy(policy, {
      ...baseInput,
      remainingPreviousOutstanding: 200,
      cashCollected: 1,
    });
    expect(result.requiredAmount).toBe(0);
    expect(result.satisfied).toBe(true);
  });

  it('rounds requiredAmount to the nearest whole rupee', () => {
    const policy: CollectionPolicy = {
      enabled: true,
      minOutstandingThreshold: 0,
      minCollectionPercentage: 33,
      allowedShortfall: 0,
    };
    const result = evaluateCollectionPolicy(policy, {
      ...baseInput,
      remainingPreviousOutstanding: 100,
      cashCollected: 33, // 100 * 33 / 100 = 33 exactly
    });
    // 101 * 0.33 = 33.33 -> exercises the rounding, not just the exact case
    const result2 = evaluateCollectionPolicy(policy, {
      ...baseInput,
      remainingPreviousOutstanding: 101,
      cashCollected: 34,
    });
    expect(result.requiredAmount).toBe(33);
    expect(result2.requiredAmount).toBe(Math.round(101 * 0.33)); // 33
    expect(result2.satisfied).toBe(true);
  });
});
