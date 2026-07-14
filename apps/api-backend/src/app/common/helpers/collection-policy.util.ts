import type { CollectionPolicy, CollectionPolicyResult } from '@water-supply-crm/types';

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
