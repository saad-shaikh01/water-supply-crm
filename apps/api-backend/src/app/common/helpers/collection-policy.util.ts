import type {
  CollectionPolicy,
  CollectionPolicyResult,
  CashCollectionPolicy,
  CashCollectionPolicyResult,
} from '@water-supply-crm/types';

export interface CollectionPolicyEvaluationInput {
  paymentType: 'MONTHLY' | 'CASH';
  isBillingExempt: boolean;
  remainingPreviousOutstanding: number;
  cashCollected: number;
}

/**
 * Pure evaluator for the Monthly Customer Collection Policy. No I/O.
 *
 * Check order matters for `reason` precedence: the threshold check runs
 * before the zero-cash check so that `ZERO_CASH` is only reported when the
 * policy would otherwise have applied (enabled, MONTHLY, not exempt, and the
 * remaining outstanding meets the threshold) — this is what the audit-log
 * gate in submitDelivery relies on to know a real collection opportunity was
 * skipped, as opposed to a delivery that was never in scope for the policy.
 */
export function evaluateCollectionPolicy(
  policy: CollectionPolicy,
  input: CollectionPolicyEvaluationInput,
): CollectionPolicyResult {
  const remainingPreviousOutstanding = Math.max(input.remainingPreviousOutstanding, 0);
  const collectedAmount = input.cashCollected;
  const base = { collectedAmount, remainingPreviousOutstanding };

  if (!policy.enabled) {
    return { applies: false, satisfied: true, reason: 'DISABLED', requiredAmount: 0, ...base };
  }
  if (input.paymentType !== 'MONTHLY') {
    return { applies: false, satisfied: true, reason: 'NOT_MONTHLY', requiredAmount: 0, ...base };
  }
  if (input.isBillingExempt) {
    return { applies: false, satisfied: true, reason: 'BILLING_EXEMPT', requiredAmount: 0, ...base };
  }
  if (remainingPreviousOutstanding < policy.minOutstandingThreshold) {
    return { applies: false, satisfied: true, reason: 'BELOW_THRESHOLD', requiredAmount: 0, ...base };
  }
  if (collectedAmount <= 0) {
    return { applies: false, satisfied: true, reason: 'ZERO_CASH', requiredAmount: 0, ...base };
  }

  const requiredAmount = Math.max(
    0,
    Math.round((remainingPreviousOutstanding * policy.minCollectionPercentage) / 100) - policy.allowedShortfall,
  );
  const satisfied = collectedAmount >= requiredAmount;

  return {
    applies: true,
    satisfied,
    reason: satisfied ? undefined : 'BELOW_MINIMUM',
    requiredAmount,
    ...base,
  };
}

export interface CashCollectionPolicyEvaluationInput {
  paymentType: 'MONTHLY' | 'CASH';
  isBillingExempt: boolean;
  /** Pre-delivery balance, this item's own prior ledger effect backed out. May be negative (credit). */
  currentBalance: number;
  /** 0 for non-posting statuses — caller encodes delivery status into this value. */
  chargeAmount: number;
  cashCollected: number;
}

/**
 * Pure evaluator for the Cash Customer Collection Policy
 * (docs/features/cash-customer-collection-policy.md §14). No I/O.
 *
 * There is no stored credit window: `requiredAmount = exposure / (N + 1)` is a
 * proportional-settlement rule whose fixed point (paid every visit) is exactly
 * `N × typical bill` — the vendor's "credit window" and "recovery" both emerge
 * from this one formula, they are not separate mechanisms (§4.3, §6).
 *
 * Check order matters for `reason` precedence (locked, §14): DISABLED →
 * NOT_CASH → BILLING_EXEMPT → NO_CHARGE → WITHIN_FLOOR → compute. Rounding is
 * DOWN to the nearest ₨10 (§4.8, locked by the product owner) — only the
 * required minimum is rounded; the caller/ledger always uses the actual
 * `cashCollected` value untouched.
 */
export function evaluateCashCollectionPolicy(
  policy: CashCollectionPolicy,
  input: CashCollectionPolicyEvaluationInput,
): CashCollectionPolicyResult {
  const currentBalance = input.currentBalance;
  const chargeAmount = input.chargeAmount;
  const exposure = currentBalance + chargeAmount;
  const collectedAmount = input.cashCollected;
  const base = { collectedAmount, currentBalance, chargeAmount, exposure, allowedCreditDeliveries: policy.allowedCreditDeliveries };

  if (!policy.enabled) {
    return { applies: false, satisfied: true, reason: 'DISABLED', requiredAmount: 0, projectedBalance: exposure - collectedAmount, ...base };
  }
  if (input.paymentType !== 'CASH') {
    return { applies: false, satisfied: true, reason: 'NOT_CASH', requiredAmount: 0, projectedBalance: exposure - collectedAmount, ...base };
  }
  if (input.isBillingExempt) {
    return { applies: false, satisfied: true, reason: 'BILLING_EXEMPT', requiredAmount: 0, projectedBalance: exposure - collectedAmount, ...base };
  }
  if (chargeAmount <= 0) {
    return { applies: false, satisfied: true, reason: 'NO_CHARGE', requiredAmount: 0, projectedBalance: exposure - collectedAmount, ...base };
  }
  if (exposure <= policy.minExposureFloor) {
    return { applies: false, satisfied: true, reason: 'WITHIN_FLOOR', requiredAmount: 0, projectedBalance: exposure - collectedAmount, ...base };
  }

  const proportional = exposure / (policy.allowedCreditDeliveries + 1);
  const ceilingTerm = policy.maxOutstandingCeiling != null ? exposure - policy.maxOutstandingCeiling : 0;
  const raw = Math.min(Math.max(Math.max(proportional, ceilingTerm), 0), exposure);
  const requiredAmount = Math.floor(raw / 10) * 10;

  if (requiredAmount <= 0) {
    return { applies: false, satisfied: true, reason: 'WITHIN_FLOOR', requiredAmount: 0, projectedBalance: exposure - collectedAmount, ...base };
  }

  const satisfied = collectedAmount >= requiredAmount;

  return {
    applies: true,
    satisfied,
    reason: satisfied ? undefined : 'BELOW_MINIMUM',
    requiredAmount,
    projectedBalance: exposure - collectedAmount,
    ...base,
  };
}

/**
 * Balance-only projection for the §8.1 admin-settings impact hint — "N of
 * your active CASH customers would owe a payment on their next delivery".
 * Deliberately NOT a call to `evaluateCashCollectionPolicy`: that function is
 * charge-aware and its locked NO_CHARGE branch would exempt every customer
 * here (there is no real delivery yet to know a charge amount for). Since
 * exposure = currentBalance + chargeAmount and chargeAmount is always >= 0
 * for a real delivery, `financialBalance > floor` is a valid necessary
 * condition for "will owe something on the next delivery" (exposure can only
 * be >= balance), and the required amount computed from balance alone is a
 * true lower bound on the real requirement. Same floor/proportional/ceiling/
 * rounding math as the evaluator's compute step (§4.2, §4.8), applied to a
 * balance treated as if it were the whole exposure.
 */
export function projectCashRequiredFromBalance(
  policy: Pick<CashCollectionPolicy, 'allowedCreditDeliveries' | 'minExposureFloor' | 'maxOutstandingCeiling'>,
  financialBalance: number,
): number {
  if (financialBalance <= policy.minExposureFloor) return 0;

  const proportional = financialBalance / (policy.allowedCreditDeliveries + 1);
  const ceilingTerm = policy.maxOutstandingCeiling != null ? financialBalance - policy.maxOutstandingCeiling : 0;
  const raw = Math.min(Math.max(Math.max(proportional, ceilingTerm), 0), financialBalance);
  return Math.floor(raw / 10) * 10;
}
