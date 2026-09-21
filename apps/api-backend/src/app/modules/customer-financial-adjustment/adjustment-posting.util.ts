import { BadRequestException } from '@nestjs/common';
import {
  ADJUSTMENT_SUMMARIZED_LABEL,
  type AdjustmentDirection,
  type AdjustmentKind,
  type AdjustmentVisibility,
} from '@water-supply-crm/types';
import {
  isFutureVendorDate,
  vendorDateString,
  vendorDayStart,
} from '../../common/helpers/date.util';

/**
 * Pure helpers for posting a Customer Financial Adjustment to the ledger. No DB,
 * no Nest providers — everything here is unit-tested in isolation
 * (adjustment-posting.util.spec.ts) so the service only orchestrates.
 */

/**
 * Kinds the create endpoint accepts in Phase 2A: the charge and credit kinds only.
 * This is a delivery-slice gate, NOT policy — the policy table in
 * libs/shared/types already defines WRITE_OFF / CORRECTION (restricted tier) and the
 * transfer legs; they are switched on by later slices (2B+) by extending this list.
 * Kept explicit rather than derived so enabling a kind is always a reviewed one-line
 * change.
 */
export const POSTABLE_ADJUSTMENT_KINDS = [
  'SERVICE_FEE',
  'PENALTY',
  'OTHER_CHARGE',
  'DISCOUNT',
  'GOODWILL_CREDIT',
  'OTHER_CREDIT',
] as const satisfies readonly AdjustmentKind[];
export type PostableAdjustmentKind = (typeof POSTABLE_ADJUSTMENT_KINDS)[number];

/** Money is Float platform-wide; adjustments are always whole paise (2 decimal places). */
const PAISE = 100;

/**
 * Validates a user-entered amount and returns it normalised to 2 decimal places.
 * Must be a finite number > 0 with at most 2 decimal places — rejected (not rounded)
 * beyond that, so a fat-fingered 1000.005 fails loudly instead of silently posting
 * a different figure than the operator typed.
 */
export function normalizeAdjustmentAmount(amount: number): number {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) {
    throw new BadRequestException('Amount must be a valid number.');
  }
  if (amount <= 0) {
    throw new BadRequestException('Amount must be greater than 0.');
  }
  const paise = Math.round(amount * PAISE);
  // Compare in paise: `amount * 100` is inexact in binary floating point
  // (e.g. 1.1 * 100 = 110.00000000000001), so allow a tiny epsilon before
  // declaring "more than 2 decimal places".
  if (Math.abs(amount * PAISE - paise) > 1e-6) {
    throw new BadRequestException('Amount can have at most 2 decimal places.');
  }
  if (paise < 1) {
    throw new BadRequestException('Amount must be at least 0.01.');
  }
  return paise / PAISE;
}

/**
 * The signed figure the ledger stores and `financialBalance` moves by:
 * CHARGE → +amount (customer owes more), CREDIT → −amount (owes less). The document
 * always keeps the POSITIVE amount; only the ledger row is signed.
 */
export function signedAdjustmentAmount(direction: AdjustmentDirection, amount: number): number {
  return direction === 'CHARGE' ? amount : -amount;
}

/**
 * What the CUSTOMER reads on the ledger row (statement, portal — which returns raw
 * Transaction rows). ITEMIZED shows the title; SUMMARIZED shows a neutral label so a
 * staff-only title never leaks. Money is never hidden — only the wording.
 */
export function customerFacingAdjustmentText(
  visibility: AdjustmentVisibility,
  title: string,
): string {
  return visibility === 'SUMMARIZED' ? ADJUSTMENT_SUMMARIZED_LABEL : title;
}

/**
 * Business date of an adjustment. Rules (owner-approved 2026-09-21):
 *  - omitted, or today's date in the vendor timezone (Asia/Karachi) → `now`, so
 *    intra-day ordering on the statement is the real posting order;
 *  - an earlier date is allowed ONLY within the current vendor calendar month
 *    (an older date could rewrite a statement the customer already received —
 *    it would also shift the overdue-warning figures, which are derived from
 *    Transaction dates); it lands at that day's vendor midnight;
 *  - a future date is rejected.
 * The returned Date is used both as the document's effectiveDate and the ledger
 * row's createdAt (the ledger's createdAt IS the business date).
 *
 * Compares vendor-timezone calendar days via vendorDateString — never the server
 * process's local day (UTC in production, 5h behind Karachi).
 */
export function resolveAdjustmentEffectiveDate(
  input: string | undefined,
  now: Date = new Date(),
): Date {
  if (input === undefined || input === null || input === '') return now;

  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException('Invalid effective date.');
  }
  if (isFutureVendorDate(input, now)) {
    throw new BadRequestException('Effective date cannot be in the future.');
  }

  const todayStr = vendorDateString(now);
  const dayStr = vendorDateString(vendorDayStart(input));
  if (dayStr === todayStr) return now;

  const monthStartStr = `${todayStr.slice(0, 7)}-01`;
  if (dayStr < monthStartStr) {
    throw new BadRequestException(
      'Effective date must be within the current month. Older dates would change a statement that has already been issued — post it dated today instead.',
    );
  }
  return vendorDayStart(input);
}
