/**
 * Customer Financial Adjustments — Phase 1 foundation (owner-approved 2026-09-21).
 *
 * Manual, non-delivery money events on a customer's account. Each is a
 * `CustomerFinancialAdjustment` document (schema.prisma) that, once POSTED, produces
 * exactly one `ADJUSTMENT` ledger `Transaction`.
 *
 * Mirrored enum unions (kept in sync with the Prisma enums by hand, same convention
 * as fleet.ts — customer-financial-adjustment.spec.ts fails if they drift) plus the
 * per-kind POLICY TABLE: the single place that says, for every kind, its direction,
 * which RBAC action may post it, what the customer reads, and whether an internal
 * note is mandatory. Adding a kind = one enum value (migration) + one entry here.
 * Both apps and the future posting service read from this file.
 *
 * Pure data + lookups only — no posting, money or date logic (Phase 2).
 */

export const ADJUSTMENT_KINDS = [
  'SERVICE_FEE',
  'PENALTY',
  'OTHER_CHARGE',
  'DISCOUNT',
  'GOODWILL_CREDIT',
  'OTHER_CREDIT',
  'TRANSFER_OUT',
  'TRANSFER_IN',
  'WRITE_OFF',
  'CORRECTION',
  'REVERSAL',
  'STAFF_FAULT_CREDIT',
] as const;
export type AdjustmentKind = (typeof ADJUSTMENT_KINDS)[number];

/** CHARGE = customer owes MORE (ledger amount +); CREDIT = owes LESS (ledger amount −). */
export const ADJUSTMENT_DIRECTIONS = ['CHARGE', 'CREDIT'] as const;
export type AdjustmentDirection = (typeof ADJUSTMENT_DIRECTIONS)[number];

export const ADJUSTMENT_STATUSES = ['POSTED', 'VOIDED'] as const;
export type AdjustmentStatus = (typeof ADJUSTMENT_STATUSES)[number];

/**
 * What the CUSTOMER reads. The amount is never hidden (the balance moves) — only the
 * wording: ITEMIZED shows the adjustment's title, SUMMARIZED shows
 * ADJUSTMENT_SUMMARIZED_LABEL. Resolved once at post time from the kind policy.
 */
export const ADJUSTMENT_VISIBILITIES = ['ITEMIZED', 'SUMMARIZED'] as const;
export type AdjustmentVisibility = (typeof ADJUSTMENT_VISIBILITIES)[number];

export const ADJUSTMENT_GROUP_TYPES = ['TRANSFER'] as const;
export type AdjustmentGroupType = (typeof ADJUSTMENT_GROUP_TYPES)[number];

/** What a customer reads on their statement/portal for a SUMMARIZED adjustment. */
export const ADJUSTMENT_SUMMARIZED_LABEL = 'Account adjustment';

/** RBAC resource (libs/shared/authz PERMISSION_CATALOG) that gates all of this. */
export const CUSTOMER_FINANCIAL_ADJUSTMENTS_RESOURCE = 'customer_financial_adjustments' as const;

/** The RBAC actions that authorize POSTING a kind (`view` / `void` are separate). */
export type AdjustmentPermissionAction =
  | 'create'
  | 'create_credit'
  | 'transfer'
  | 'create_restricted';

/**
 * How a kind may come into existence:
 *  - STANDALONE: posted alone through the ordinary create endpoint;
 *  - TRANSFER:   only as one leg of a balance-transfer group (transfer endpoint);
 *  - SYSTEM:     only created by the system (void → REVERSAL); never by a user request.
 */
export type AdjustmentCreationPath = 'STANDALONE' | 'TRANSFER' | 'SYSTEM';

export interface AdjustmentKindPolicy {
  /** Staff-facing name of the kind (dropdowns, list rows). */
  label: string;
  /**
   * Fixed direction, or `'EITHER'` when staff choose it (CORRECTION), or `'DERIVED'`
   * when it mirrors another document (REVERSAL is the opposite of the voided one).
   */
  direction: AdjustmentDirection | 'EITHER' | 'DERIVED';
  /** RBAC action needed to post this kind; `null` for the system-only REVERSAL (governed by `void`). */
  permission: AdjustmentPermissionAction | null;
  /**
   * How the customer sees it — see AdjustmentVisibility. No per-document override in V1.
   * `'DERIVED'` (REVERSAL only): copies the voided original's visibility, so a
   * SUMMARIZED write-off is never un-hidden by voiding it.
   */
  visibility: AdjustmentVisibility | 'DERIVED';
  /** True when a non-empty internal note is mandatory (why was the balance reduced/rewritten?). */
  requiresInternalNote: boolean;
  creation: AdjustmentCreationPath;
}

/**
 * Policy table. Rules it encodes (each is asserted in the spec):
 *  - Charges are `create`; credits are `create_credit`; transfers `transfer`;
 *    write-off/correction `create_restricted` — so an admin can allow "post a fee"
 *    without allowing "reduce what a customer owes".
 *  - A CHARGE is never less than ITEMIZED — the customer is always told what they
 *    were billed for. Only the internal kinds (write-off, correction) are SUMMARIZED.
 *  - Every credit, write-off and correction needs an internal note. Transfer legs do
 *    not: the group + counterparty link is their audit trail and the title is
 *    auto-generated ("Balance transferred to/from CODE"). REVERSAL takes its reason
 *    from the void reason on the original.
 */
export const ADJUSTMENT_KIND_POLICY: Readonly<Record<AdjustmentKind, AdjustmentKindPolicy>> = {
  SERVICE_FEE: {
    label: 'Service fee',
    direction: 'CHARGE',
    permission: 'create',
    visibility: 'ITEMIZED',
    requiresInternalNote: false,
    creation: 'STANDALONE',
  },
  PENALTY: {
    label: 'Penalty',
    direction: 'CHARGE',
    permission: 'create',
    visibility: 'ITEMIZED',
    requiresInternalNote: false,
    creation: 'STANDALONE',
  },
  OTHER_CHARGE: {
    label: 'Other charge',
    direction: 'CHARGE',
    permission: 'create',
    visibility: 'ITEMIZED',
    requiresInternalNote: false,
    creation: 'STANDALONE',
  },
  DISCOUNT: {
    label: 'Discount',
    direction: 'CREDIT',
    permission: 'create_credit',
    visibility: 'ITEMIZED',
    requiresInternalNote: true,
    creation: 'STANDALONE',
  },
  GOODWILL_CREDIT: {
    label: 'Goodwill credit',
    direction: 'CREDIT',
    permission: 'create_credit',
    visibility: 'ITEMIZED',
    requiresInternalNote: true,
    creation: 'STANDALONE',
  },
  OTHER_CREDIT: {
    label: 'Other credit',
    direction: 'CREDIT',
    permission: 'create_credit',
    visibility: 'ITEMIZED',
    requiresInternalNote: true,
    creation: 'STANDALONE',
  },
  TRANSFER_OUT: {
    label: 'Transfer out',
    direction: 'CREDIT', // the SOURCE customer owes less
    permission: 'transfer',
    visibility: 'ITEMIZED',
    requiresInternalNote: false,
    creation: 'TRANSFER',
  },
  TRANSFER_IN: {
    label: 'Transfer in',
    direction: 'CHARGE', // the TARGET customer owes more
    permission: 'transfer',
    visibility: 'ITEMIZED',
    requiresInternalNote: false,
    creation: 'TRANSFER',
  },
  WRITE_OFF: {
    label: 'Write-off',
    direction: 'CREDIT',
    permission: 'create_restricted',
    visibility: 'SUMMARIZED',
    requiresInternalNote: true,
    creation: 'STANDALONE',
  },
  CORRECTION: {
    label: 'Correction',
    direction: 'EITHER',
    permission: 'create_restricted',
    visibility: 'SUMMARIZED',
    requiresInternalNote: true,
    creation: 'STANDALONE',
  },
  REVERSAL: {
    label: 'Reversal',
    direction: 'DERIVED',
    permission: null,
    visibility: 'DERIVED',
    requiresInternalNote: false,
    creation: 'SYSTEM',
  },
  // Linked Penalty (owner-approved 2026-09-25) — the customer-side credit half
  // of a staff penalty for an unrecorded/undeposited customer payment
  // (LinkedPenaltyService). Also postable standalone for a plain manual
  // correction of the same shape, not only via the linked flow.
  STAFF_FAULT_CREDIT: {
    label: 'Staff-fault credit',
    direction: 'CREDIT',
    permission: 'create_credit',
    visibility: 'ITEMIZED',
    requiresInternalNote: true,
    creation: 'STANDALONE',
  },
};

/** Kinds a user may post alone through the create endpoint (excludes transfer legs + REVERSAL). */
export const STANDALONE_ADJUSTMENT_KINDS: readonly AdjustmentKind[] = ADJUSTMENT_KINDS.filter(
  (k) => ADJUSTMENT_KIND_POLICY[k].creation === 'STANDALONE',
);

/** Full RBAC permission string needed to post a kind, or `null` for the system-only REVERSAL. */
export function adjustmentKindPermission(
  kind: AdjustmentKind,
): `${typeof CUSTOMER_FINANCIAL_ADJUSTMENTS_RESOURCE}:${AdjustmentPermissionAction}` | null {
  const action = ADJUSTMENT_KIND_POLICY[kind].permission;
  return action ? `${CUSTOMER_FINANCIAL_ADJUSTMENTS_RESOURCE}:${action}` : null;
}
