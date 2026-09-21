import type { Permission } from '@water-supply-crm/authz';
import {
  ADJUSTMENT_KIND_POLICY,
  STANDALONE_ADJUSTMENT_KINDS,
  adjustmentKindPermission,
} from '@water-supply-crm/types';
import { usePermissions } from '../authz/hooks/use-permissions';
import type { CustomerAdjustment, PostableAdjustmentKind } from './api/customer-adjustments.api';

/** RBAC action that authorizes voiding (a static permission — unlike posting, it does not depend on the kind). */
export const VOID_PERMISSION = 'customer_financial_adjustments:void' as const satisfies Permission;

const POSTABLE_KINDS = STANDALONE_ADJUSTMENT_KINDS as readonly PostableAdjustmentKind[];

/**
 * The kinds this user may post: every standalone kind whose OWN permission they hold —
 * `create` (charges), `create_credit` (credits), `create_restricted` (write-off, correction).
 * Same rule the backend enforces per kind; this only decides what to OFFER.
 */
export function postableKindsFor(can: (permission: Permission) => boolean): PostableAdjustmentKind[] {
  return POSTABLE_KINDS.filter((kind) => {
    const required = adjustmentKindPermission(kind);
    return !!required && can(required);
  });
}

/**
 * Whether an adjustment is eligible to be voided (the backend's rules, mirrored so the button is
 * never offered for something that would be refused): still POSTED, not itself a REVERSAL, and not
 * one leg of a balance transfer (a transfer is voided as a whole group, a different endpoint).
 */
export function isVoidable(adjustment: Pick<CustomerAdjustment, 'status' | 'kind' | 'groupId'>): boolean {
  return (
    adjustment.status === 'POSTED' &&
    adjustment.kind !== 'REVERSAL' &&
    !adjustment.groupId &&
    ADJUSTMENT_KIND_POLICY[adjustment.kind].creation === 'STANDALONE'
  );
}

/** What the current user may do on the Charges & Credits tab. */
export function useAdjustmentPermissions() {
  const { can } = usePermissions();
  const postableKinds = postableKindsFor(can);
  return {
    postableKinds,
    canCreate: postableKinds.length > 0,
    canVoid: can(VOID_PERMISSION),
  };
}
