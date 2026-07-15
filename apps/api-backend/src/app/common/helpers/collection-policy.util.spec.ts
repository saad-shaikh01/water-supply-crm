import { evaluateCollectionPolicy, evaluateCashCollectionPolicy, projectCashRequiredFromBalance } from './collection-policy.util';
import type { CollectionPolicy, CashCollectionPolicy } from '@water-supply-crm/types';

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

/**
 * Tests for the Cash Customer Collection Policy evaluator
 * (docs/features/cash-customer-collection-policy.md §14). Every row of the
 * doc's §4.4 worked-example tables A–H is asserted here — that section is
 * explicitly declared "the required Phase 1 unit-test fixtures" in the doc's
 * own Change Log entry for the architecture's final validation pass.
 */
describe('evaluateCashCollectionPolicy', () => {
  const POLICY: CashCollectionPolicy = {
    enabled: true,
    allowedCreditDeliveries: 2, // N
    minExposureFloor: 500,
    maxOutstandingCeiling: null,
  };

  const baseInput = {
    paymentType: 'CASH' as const,
    isBillingExempt: false,
    currentBalance: 0,
    chargeAmount: 0,
    cashCollected: 0,
  };

  // ── Exemptions (applies = false) ─────────────────────────────────────────

  it('is exempt when the policy is disabled', () => {
    const result = evaluateCashCollectionPolicy(
      { ...POLICY, enabled: false },
      { ...baseInput, currentBalance: 600, chargeAmount: 300, cashCollected: 1 },
    );
    expect(result).toEqual({
      applies: false,
      satisfied: true,
      reason: 'DISABLED',
      requiredAmount: 0,
      collectedAmount: 1,
      currentBalance: 600,
      chargeAmount: 300,
      exposure: 900,
      projectedBalance: 899,
      allowedCreditDeliveries: 2,
    });
  });

  it('is exempt for MONTHLY-type customers', () => {
    const result = evaluateCashCollectionPolicy(POLICY, {
      ...baseInput,
      paymentType: 'MONTHLY',
      currentBalance: 600,
      chargeAmount: 300,
      cashCollected: 1,
    });
    expect(result.applies).toBe(false);
    expect(result.reason).toBe('NOT_CASH');
  });

  it('is exempt for billing-exempt CASH customers', () => {
    const result = evaluateCashCollectionPolicy(POLICY, {
      ...baseInput,
      isBillingExempt: true,
      currentBalance: 600,
      chargeAmount: 300,
      cashCollected: 1,
    });
    expect(result.applies).toBe(false);
    expect(result.reason).toBe('BILLING_EXEMPT');
  });

  it('is exempt (NO_CHARGE) for non-posting submissions regardless of balance size', () => {
    // Failure statuses / EMPTY_ONLY encode chargeAmount=0 at the call site (§4.5.4) —
    // these must never be blocked, even against a very large existing balance.
    const result = evaluateCashCollectionPolicy(POLICY, {
      ...baseInput,
      currentBalance: 50000,
      chargeAmount: 0,
      cashCollected: 0,
    });
    expect(result.applies).toBe(false);
    expect(result.reason).toBe('NO_CHARGE');
  });

  it('is exempt (WITHIN_FLOOR) when exposure is at or below the floor', () => {
    const atFloor = evaluateCashCollectionPolicy(POLICY, {
      ...baseInput,
      currentBalance: 200,
      chargeAmount: 300,
      cashCollected: 0,
    }); // exposure = 500 = floor exactly, "<=" must exempt
    expect(atFloor.applies).toBe(false);
    expect(atFloor.reason).toBe('WITHIN_FLOOR');

    const belowFloor = evaluateCashCollectionPolicy(POLICY, {
      ...baseInput,
      currentBalance: 100,
      chargeAmount: 300,
      cashCollected: 0,
    }); // exposure = 400 < floor
    expect(belowFloor.applies).toBe(false);
    expect(belowFloor.reason).toBe('WITHIN_FLOOR');
  });

  // ── Reason precedence (locked check order, §14) ───────────────────────────

  it('reports NO_CHARGE rather than WITHIN_FLOOR when both conditions hold', () => {
    // chargeAmount<=0 is checked before exposure<=floor in the locked order
    // (DISABLED -> NOT_CASH -> BILLING_EXEMPT -> NO_CHARGE -> WITHIN_FLOOR).
    // balance=0, charge=0 -> exposure=0, which is both <=floor AND the charge is 0.
    const result = evaluateCashCollectionPolicy(POLICY, {
      ...baseInput,
      currentBalance: 0,
      chargeAmount: 0,
      cashCollected: 0,
    });
    expect(result.reason).toBe('NO_CHARGE');
  });

  it('DISABLED takes precedence over every other condition', () => {
    const result = evaluateCashCollectionPolicy(
      { ...POLICY, enabled: false },
      { ...baseInput, paymentType: 'MONTHLY', isBillingExempt: true, chargeAmount: 0 },
    );
    expect(result.reason).toBe('DISABLED');
  });

  // ── §4.4 Table A: new customer converging to the emergent window ─────────
  // N=2, floor=500, ceiling=null, B=300, minimum payer every visit.

  describe('Table A: new customer converging to the emergent window (B=300)', () => {
    it.each([
      // [O_before, exposure, expectedRequired, expectedReason]
      [0, 300, 0, 'WITHIN_FLOOR'],
      [300, 600, 200, undefined],
      [400, 700, 230, undefined],
      [470, 770, 250, undefined],
      [520, 820, 270, undefined],
      [550, 850, 280, undefined],
      [570, 870, 290, undefined],
      [580, 880, 290, undefined],
      [590, 890, 290, undefined],
      [600, 900, 300, undefined], // fixed point: O_after = 600 + 300 - 300 = 600
    ])('O=%d -> exposure=%d -> required=%d', (O, exposure, expectedRequired, expectedReason) => {
      const result = evaluateCashCollectionPolicy(POLICY, {
        ...baseInput,
        currentBalance: O,
        chargeAmount: 300,
        cashCollected: expectedRequired, // minimum payer
      });
      expect(result.exposure).toBe(exposure);
      expect(result.requiredAmount).toBe(expectedRequired);
      if (expectedReason) expect(result.reason).toBe(expectedReason);
      expect(result.satisfied).toBe(true);
    });

    it('the fixed point (O=600) is exactly stable under minimum payment', () => {
      const result = evaluateCashCollectionPolicy(POLICY, {
        ...baseInput,
        currentBalance: 600,
        chargeAmount: 300,
        cashCollected: 300,
      });
      expect(result.projectedBalance).toBe(600);
    });
  });

  // ── §4.4 Table B: legacy/over-window debt recovering geometrically ───────
  // O=1500, B=300, N=2, floor=500.

  describe('Table B: legacy debt recovering geometrically (O=1500, B=300)', () => {
    it.each([
      [1500, 1800, 600],
      [1200, 1500, 500],
      [1000, 1300, 430],
      [870, 1170, 390],
      [780, 1080, 360],
      [720, 1020, 340],
      [680, 980, 320],
      [660, 960, 320],
      [640, 940, 310],
      [630, 930, 310],
      [620, 920, 300], // settles inside the equilibrium band [600, 630) and stays
    ])('O=%d -> exposure=%d -> required=%d', (O, exposure, expectedRequired) => {
      const result = evaluateCashCollectionPolicy(POLICY, {
        ...baseInput,
        currentBalance: O,
        chargeAmount: 300,
        cashCollected: expectedRequired,
      });
      expect(result.exposure).toBe(exposure);
      expect(result.requiredAmount).toBe(expectedRequired);
    });

    it('settling at O=620 is stable under minimum payment (inside the band)', () => {
      const result = evaluateCashCollectionPolicy(POLICY, {
        ...baseInput,
        currentBalance: 620,
        chargeAmount: 300,
        cashCollected: 300,
      });
      expect(result.projectedBalance).toBe(620);
    });
  });

  // ── §4.4 Table C: consumption spike (party order) ─────────────────────────

  it('Table C: a one-off spike order extends proportional credit, not full credit', () => {
    // O=600 (at the emergent window), B=3000 -> exposure=3600 -> required=1200.
    const result = evaluateCashCollectionPolicy(POLICY, {
      ...baseInput,
      currentBalance: 600,
      chargeAmount: 3000,
      cashCollected: 1200,
    });
    expect(result.exposure).toBe(3600);
    expect(result.requiredAmount).toBe(1200);
    expect(result.satisfied).toBe(true);
    expect(result.projectedBalance).toBe(2400); // "gets ~2,400 of temporary credit on the spike"
  });

  // ── §4.4 Table D: large customer, same config, proportionally correct ────

  it('Table D: a large customer converges to its own proportional window (B=3000)', () => {
    // The floor (500) is irrelevant at this scale; steady state = N*B = 6000,
    // required at steady state = exactly one bill (3000).
    const result = evaluateCashCollectionPolicy(POLICY, {
      ...baseInput,
      currentBalance: 6000,
      chargeAmount: 3000,
      cashCollected: 3000,
    });
    expect(result.exposure).toBe(9000);
    expect(result.requiredAmount).toBe(3000);
    expect(result.projectedBalance).toBe(6000); // fixed point, proportional to this customer's own bill
  });

  // ── §4.4 Table E: COD vendor (N=0) ────────────────────────────────────────

  it('Table E: N=0 is full settlement (required = exposure) every visit', () => {
    const codPolicy: CashCollectionPolicy = { ...POLICY, allowedCreditDeliveries: 0 };
    const result = evaluateCashCollectionPolicy(codPolicy, {
      ...baseInput,
      currentBalance: 0,
      chargeAmount: 600,
      cashCollected: 600,
    });
    expect(result.exposure).toBe(600);
    expect(result.requiredAmount).toBe(600); // = exposure exactly (already a multiple of 10)
    expect(result.projectedBalance).toBe(0);
  });

  // ── §4.4 Table F: credit balance ──────────────────────────────────────────

  it('Table F: an existing credit balance is consumed before any requirement resumes', () => {
    const result = evaluateCashCollectionPolicy(POLICY, {
      ...baseInput,
      currentBalance: -500,
      chargeAmount: 300,
      cashCollected: 0,
    });
    expect(result.exposure).toBe(-200);
    expect(result.applies).toBe(false);
    expect(result.reason).toBe('WITHIN_FLOOR');
  });

  // ── §4.4 Table G: optional absolute ceiling engaged ───────────────────────

  describe('Table G: optional absolute ceiling', () => {
    const ceilingPolicy: CashCollectionPolicy = { ...POLICY, maxOutstandingCeiling: 5000 };

    it('ceiling below the proportional term has no effect (proportional wins via max())', () => {
      // exposure=7000, proportional=2333.33, ceilingTerm=2000 -> max keeps proportional.
      const result = evaluateCashCollectionPolicy(ceilingPolicy, {
        ...baseInput,
        currentBalance: 4000,
        chargeAmount: 3000,
        cashCollected: 2330,
      });
      expect(result.exposure).toBe(7000);
      expect(result.requiredAmount).toBe(2330); // floor10(2333.33)
      expect(result.satisfied).toBe(true);
    });

    it('ceiling above the proportional term binds as the absolute safety net', () => {
      // exposure=9000, proportional=3000, ceilingTerm=4000 -> ceiling wins via max().
      const result = evaluateCashCollectionPolicy(ceilingPolicy, {
        ...baseInput,
        currentBalance: 6000,
        chargeAmount: 3000,
        cashCollected: 4000,
      });
      expect(result.exposure).toBe(9000);
      expect(result.requiredAmount).toBe(4000);
      expect(result.projectedBalance).toBe(5000); // bounded at the ceiling
    });

    it('a null ceiling never clamps anything (regression guard against accidental clamping)', () => {
      // Same inputs as Table D's fixed point — must match byte-for-byte with ceiling: null.
      const withNullCeiling = evaluateCashCollectionPolicy(
        { ...POLICY, maxOutstandingCeiling: null },
        { ...baseInput, currentBalance: 6000, chargeAmount: 3000, cashCollected: 3000 },
      );
      const withoutCeilingField = evaluateCashCollectionPolicy(POLICY, {
        ...baseInput,
        currentBalance: 6000,
        chargeAmount: 3000,
        cashCollected: 3000,
      });
      expect(withNullCeiling).toEqual(withoutCeilingField);
      expect(withNullCeiling.requiredAmount).toBe(3000);
    });
  });

  // ── §4.4 Table H: the chronic small-payer (canonical scenario) ───────────

  describe('Table H: chronic Rs.100-payer — no coast-to-max phase', () => {
    it('visit 1: exposure=300 (<=floor), Rs.100 is accepted (WITHIN_FLOOR, no requirement)', () => {
      const result = evaluateCashCollectionPolicy(POLICY, {
        ...baseInput,
        currentBalance: 0,
        chargeAmount: 300,
        cashCollected: 100,
      });
      expect(result.exposure).toBe(300);
      expect(result.applies).toBe(false);
      expect(result.reason).toBe('WITHIN_FLOOR');
      expect(result.projectedBalance).toBe(200); // O_after = 0 + 300 - 100
    });

    it('visit 2: exposure=500 (=floor exactly), Rs.100 is still accepted', () => {
      const result = evaluateCashCollectionPolicy(POLICY, {
        ...baseInput,
        currentBalance: 200,
        chargeAmount: 300,
        cashCollected: 100,
      });
      expect(result.exposure).toBe(500);
      expect(result.applies).toBe(false);
      expect(result.projectedBalance).toBe(400);
    });

    it('visit 3: exposure=700 (>floor), Rs.100 is NO LONGER accepted — required=230', () => {
      const attempted100 = evaluateCashCollectionPolicy(POLICY, {
        ...baseInput,
        currentBalance: 400,
        chargeAmount: 300,
        cashCollected: 100,
      });
      expect(attempted100.exposure).toBe(700);
      expect(attempted100.requiredAmount).toBe(230);
      expect(attempted100.applies).toBe(true);
      expect(attempted100.satisfied).toBe(false); // the Rs.100 habit breaks here — no coast-to-max phase
    });

    it('visit 4: requirement keeps ramping toward the same terminal window (O~470 -> required~250)', () => {
      const result = evaluateCashCollectionPolicy(POLICY, {
        ...baseInput,
        currentBalance: 470,
        chargeAmount: 300,
        cashCollected: 250,
      });
      expect(result.exposure).toBe(770);
      expect(result.requiredAmount).toBe(250);
      expect(result.satisfied).toBe(true);
    });
  });

  // ── Rounding: locked example values (§4.8) ────────────────────────────────

  describe('rounding: down to the nearest Rs.10 (locked)', () => {
    // Isolate rounding with floor=0 and N=2 (divisor 3): exposure = raw*3 lands
    // exactly on the doc's own worked pre-rounding values.
    const roundingPolicy: CashCollectionPolicy = {
      enabled: true,
      allowedCreditDeliveries: 2,
      minExposureFloor: 0,
      maxOutstandingCeiling: null,
    };

    it.each([
      [1029, 343, 340], // 343 -> 340
      [1041, 347, 340], // 347 -> 340
      [1077, 359, 350], // 359 -> 350
    ])('exposure=%d (raw=%d) rounds DOWN to %d', (exposure, _raw, expectedRequired) => {
      const result = evaluateCashCollectionPolicy(roundingPolicy, {
        ...baseInput,
        currentBalance: 0,
        chargeAmount: exposure,
        cashCollected: 0,
      });
      expect(result.requiredAmount).toBe(expectedRequired);
    });

    it('rounding never rounds UP: a raw value just under a multiple of 10 still rounds down', () => {
      // raw = 349.999... would round to 350 with Math.round but must floor to 340.
      const result = evaluateCashCollectionPolicy(roundingPolicy, {
        ...baseInput,
        currentBalance: 0,
        chargeAmount: 3 * 349.9, // raw = 349.9
        cashCollected: 0,
      });
      expect(result.requiredAmount).toBe(340);
    });

    it('only the minimum requirement is rounded — collectedAmount and projectedBalance stay exact', () => {
      // Locked example: required rounds to 340, but the driver's actual collected
      // amount (500) must be reflected byte-for-byte, never coerced to a round figure.
      const result = evaluateCashCollectionPolicy(roundingPolicy, {
        ...baseInput,
        currentBalance: 0,
        chargeAmount: 1029, // raw=343 -> required=340
        cashCollected: 500,
      });
      expect(result.requiredAmount).toBe(340);
      expect(result.collectedAmount).toBe(500);
      expect(result.projectedBalance).toBe(529); // 1029 - 500, not 1029 - 340
      expect(result.satisfied).toBe(true);
    });
  });

  // ── requiredAmount <= exposure invariant (§4.2 guarantee) ─────────────────

  it.each([
    [400, 300, 700, 230],   // Table A visit 3
    [1500, 300, 1800, 600], // Table B visit 1
    [600, 3000, 3600, 1200],// Table C spike
    [6000, 3000, 9000, 3000], // Table D fixed point
  ])(
    'requiredAmount never exceeds exposure (O=%d, B=%d)',
    (O, B, expectedExposure, expectedRequired) => {
      const result = evaluateCashCollectionPolicy(POLICY, {
        ...baseInput,
        currentBalance: O,
        chargeAmount: B,
        cashCollected: 0,
      });
      expect(result.exposure).toBe(expectedExposure);
      expect(result.requiredAmount).toBe(expectedRequired);
      expect(result.requiredAmount).toBeLessThanOrEqual(result.exposure);
      expect(result.applies).toBe(result.requiredAmount > 0);
    },
  );

  // ── Negative / credit balances combined with a real charge ───────────────

  describe('negative (credit) balances netted against a new charge', () => {
    it('a large credit balance can fully absorb a large charge (exempt)', () => {
      const result = evaluateCashCollectionPolicy(POLICY, {
        ...baseInput,
        currentBalance: -2000,
        chargeAmount: 1500,
        cashCollected: 0,
      });
      expect(result.exposure).toBe(-500);
      expect(result.applies).toBe(false);
      expect(result.reason).toBe('WITHIN_FLOOR');
    });

    it('a partial credit balance still requires proportional settlement on the net exposure', () => {
      const result = evaluateCashCollectionPolicy(POLICY, {
        ...baseInput,
        currentBalance: -2000,
        chargeAmount: 3000,
        cashCollected: 330,
      });
      expect(result.exposure).toBe(1000);
      expect(result.requiredAmount).toBe(330); // floor10(1000/3) = floor10(333.33) = 330
      expect(result.satisfied).toBe(true);
    });

    it('a small credit balance barely dents a large charge', () => {
      const result = evaluateCashCollectionPolicy(POLICY, {
        ...baseInput,
        currentBalance: -100,
        chargeAmount: 3000,
        cashCollected: 960,
      });
      expect(result.exposure).toBe(2900);
      expect(result.requiredAmount).toBe(960); // floor10(2900/3) = floor10(966.67) = 960
    });
  });

  // ── projectedBalance is always exposure - collectedAmount, in every branch ─

  it.each([
    ['DISABLED branch', { ...POLICY, enabled: false }, { currentBalance: 100, chargeAmount: 200, cashCollected: 50 }],
    ['WITHIN_FLOOR branch', POLICY, { currentBalance: 0, chargeAmount: 300, cashCollected: 0 }],
    ['BELOW_MINIMUM (violation) branch', POLICY, { currentBalance: 600, chargeAmount: 300, cashCollected: 0 }],
    ['satisfied branch', POLICY, { currentBalance: 600, chargeAmount: 300, cashCollected: 300 }],
  ])('projectedBalance = exposure - collectedAmount (%s)', (_label, policy, input) => {
    const result = evaluateCashCollectionPolicy(policy, { ...baseInput, ...input });
    expect(result.projectedBalance).toBe(result.exposure - input.cashCollected);
  });
});

/**
 * Convergence/contraction property test — a regression guard, not exhaustive.
 * Simulates a customer paying exactly `requiredAmount` (or the exempt 0) every
 * visit and asserts the balance converges into, and stays within, the doc's
 * stated equilibrium band [N*B, N*B + 10*(N+1)) (§4.8) rather than diverging
 * or oscillating outside it. Reproduces §4.4 Table A's own numbers exactly.
 */
describe('evaluateCashCollectionPolicy — convergence property', () => {
  it('a minimum-paying customer converges to the equilibrium band and stays there', () => {
    const policy: CashCollectionPolicy = {
      enabled: true,
      allowedCreditDeliveries: 2, // N=2
      minExposureFloor: 500,
      maxOutstandingCeiling: null,
    };
    const B = 300;
    const N = policy.allowedCreditDeliveries;
    const bandLow = N * B; // 600
    const bandHigh = N * B + 10 * (N + 1); // 630

    let O = 0;
    const balancesAfterEachVisit: number[] = [];

    for (let visit = 1; visit <= 20; visit++) {
      // First evaluate with cashCollected=0 purely to read requiredAmount, then
      // pay exactly that amount (the minimum-payer trajectory Table A documents).
      const probe = evaluateCashCollectionPolicy(policy, {
        paymentType: 'CASH',
        isBillingExempt: false,
        currentBalance: O,
        chargeAmount: B,
        cashCollected: 0,
      });
      const required = probe.applies ? probe.requiredAmount : 0;

      const result = evaluateCashCollectionPolicy(policy, {
        paymentType: 'CASH',
        isBillingExempt: false,
        currentBalance: O,
        chargeAmount: B,
        cashCollected: required,
      });
      expect(result.satisfied).toBe(true); // paying exactly the required minimum always satisfies

      O = result.projectedBalance;
      balancesAfterEachVisit.push(O);
    }

    // Reproduces Table A exactly: exact fixed point of 600 by visit 10.
    expect(balancesAfterEachVisit[9]).toBe(600); // 1-indexed visit 10 -> index 9

    // Never diverges: the balance must land in, and stay within, the
    // documented equilibrium band for every visit from convergence onward.
    for (let i = 9; i < balancesAfterEachVisit.length; i++) {
      expect(balancesAfterEachVisit[i]).toBeGreaterThanOrEqual(bandLow);
      expect(balancesAfterEachVisit[i]).toBeLessThan(bandHigh);
    }
  });

  it('legacy debt (O=1500) recovers geometrically and settles inside the same band, never oscillating outward', () => {
    const policy: CashCollectionPolicy = {
      enabled: true,
      allowedCreditDeliveries: 2,
      minExposureFloor: 500,
      maxOutstandingCeiling: null,
    };
    const B = 300;
    const N = policy.allowedCreditDeliveries;
    const bandLow = N * B;
    const bandHigh = N * B + 10 * (N + 1);

    let O = 1500;
    let previous = O;
    for (let visit = 1; visit <= 15; visit++) {
      const probe = evaluateCashCollectionPolicy(policy, {
        paymentType: 'CASH',
        isBillingExempt: false,
        currentBalance: O,
        chargeAmount: B,
        cashCollected: 0,
      });
      const required = probe.applies ? probe.requiredAmount : 0;
      const result = evaluateCashCollectionPolicy(policy, {
        paymentType: 'CASH',
        isBillingExempt: false,
        currentBalance: O,
        chargeAmount: B,
        cashCollected: required,
      });

      // Monotone decline while above the band — every visit strictly reduces
      // the balance until it enters the equilibrium band (no oscillation on the way down).
      if (previous >= bandHigh) {
        expect(result.projectedBalance).toBeLessThan(previous);
      }
      previous = O;
      O = result.projectedBalance;
    }

    expect(O).toBeGreaterThanOrEqual(bandLow);
    expect(O).toBeLessThan(bandHigh);
    expect(O).toBe(620); // matches Table B's documented settling point exactly
  });
});

/**
 * Tests for `projectCashRequiredFromBalance` — the balance-only projection
 * powering the §8.1 settings-page impact hint (Phase 2). Distinct from
 * `evaluateCashCollectionPolicy`: no chargeAmount, no NO_CHARGE branch, no
 * DISABLED/NOT_CASH/BILLING_EXEMPT reasons — just the floor/proportional/
 * ceiling/rounding compute step applied directly to a balance.
 */
describe('projectCashRequiredFromBalance', () => {
  const POLICY = { allowedCreditDeliveries: 2, minExposureFloor: 500, maxOutstandingCeiling: null as number | null };

  it('returns 0 when the balance is at or below the floor', () => {
    expect(projectCashRequiredFromBalance(POLICY, 500)).toBe(0);
    expect(projectCashRequiredFromBalance(POLICY, 300)).toBe(0);
    expect(projectCashRequiredFromBalance(POLICY, -100)).toBe(0);
  });

  it('computes the same proportional/rounded requirement as the delivery evaluator would for the same exposure', () => {
    // Table A visit 3 in the doc: exposure=700 -> required=230.
    expect(projectCashRequiredFromBalance(POLICY, 700)).toBe(230);
    // Table B visit 1: exposure=1800 -> required=600.
    expect(projectCashRequiredFromBalance(POLICY, 1800)).toBe(600);
  });

  it('a ceiling raises the requirement only when it exceeds the proportional term', () => {
    const withCeiling = { ...POLICY, maxOutstandingCeiling: 5000 };
    // Table G row 1: exposure=7000 -> proportional wins (2330).
    expect(projectCashRequiredFromBalance(withCeiling, 7000)).toBe(2330);
    // Table G row 2: exposure=9000 -> ceiling wins (4000).
    expect(projectCashRequiredFromBalance(withCeiling, 9000)).toBe(4000);
  });

  it('N=0 (COD) requires the full balance, rounded down', () => {
    const codPolicy = { allowedCreditDeliveries: 0, minExposureFloor: 0, maxOutstandingCeiling: null };
    expect(projectCashRequiredFromBalance(codPolicy, 347)).toBe(340);
  });
});
