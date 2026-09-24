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
 * Kinds the create endpoint accepts: the charge and credit kinds (2A) plus the
 * restricted tier, WRITE_OFF and CORRECTION (2D). This is a delivery gate, NOT policy —
 * the policy table in libs/shared/types defines every kind; the transfer legs and
 * REVERSAL are deliberately absent (transfers have their own endpoint later; a
 * reversal is only ever created by void). Kept explicit rather than derived so
 * enabling a kind is always a reviewed one-line change.
 */
export const POSTABLE_ADJUSTMENT_KINDS = [
  'SERVICE_FEE',
  'PENALTY',
  'OTHER_CHARGE',
  'DISCOUNT',
  'GOODWILL_CREDIT',
  'OTHER_CREDIT',
  'WRITE_OFF',
  'CORRECTION',
  'STAFF_FAULT_CREDIT',
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
 * The direction a request resolves to, given the kind's policy and what the caller sent.
 *  - fixed kind (charges, credits, write-off): the policy direction wins. A caller may
 *    send the SAME value, but a conflicting one is a 400 — never silently ignored, so a
 *    "penalty" can never be posted as a balance reduction and an API client can't believe
 *    it did something it didn't. (The app's global pipe is forbidNonWhitelisted, so the
 *    field only exists on the DTO for CORRECTION.)
 *  - 'EITHER' (CORRECTION): the caller MUST say whether it increases (CHARGE) or reduces
 *    (CREDIT) what the customer owes — there is no safe default for a correction.
 *  - 'DERIVED' (REVERSAL): never posted by a request.
 */
export function resolveAdjustmentDirection(
  policyDirection: AdjustmentDirection | 'EITHER' | 'DERIVED',
  supplied?: AdjustmentDirection,
): AdjustmentDirection {
  if (policyDirection === 'DERIVED') {
    throw new BadRequestException('This kind of adjustment cannot be posted directly.');
  }
  if (policyDirection === 'EITHER') {
    if (supplied !== 'CHARGE' && supplied !== 'CREDIT') {
      throw new BadRequestException(
        'A correction must say whether it increases (CHARGE) or reduces (CREDIT) what the customer owes.',
      );
    }
    return supplied;
  }
  if (supplied !== undefined && supplied !== null && supplied !== policyDirection) {
    throw new BadRequestException(
      `The direction of this adjustment is fixed (${policyDirection}); it cannot be ${supplied}.`,
    );
  }
  return policyDirection;
}

/**
 * The signed figure the ledger stores and `financialBalance` moves by:
 * CHARGE → +amount (customer owes more), CREDIT → −amount (owes less). The document
 * always keeps the POSITIVE amount; only the ledger row is signed.
 */
export function signedAdjustmentAmount(direction: AdjustmentDirection, amount: number): number {
  return direction === 'CHARGE' ? amount : -amount;
}

/** The direction of the reversal that cancels an adjustment of the given direction. */
export function oppositeAdjustmentDirection(direction: AdjustmentDirection): AdjustmentDirection {
  return direction === 'CHARGE' ? 'CREDIT' : 'CHARGE';
}

/**
 * What the CUSTOMER reads on a REVERSAL's ledger row. Mirrors the original's
 * visibility (a SUMMARIZED write-off must not be un-hidden by voiding it): ITEMIZED
 * names what was reversed, SUMMARIZED stays neutral. Never carries the void reason —
 * that is staff-only.
 */
export function customerFacingReversalText(
  visibility: AdjustmentVisibility,
  originalTitle: string,
): string {
  return visibility === 'SUMMARIZED'
    ? `${ADJUSTMENT_SUMMARIZED_LABEL} reversal`
    : `Reversal: ${originalTitle}`;
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
 *    Transaction dates); it lands at that day's vendor NOON (see below);
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
  // Vendor-day NOON, deliberately not midnight. Statement month windows are cut at the
  // SERVER's local midnight (customer.service getMonthlyStatement: `new Date(y, m, 1)`)
  // and production runs UTC, while the vendor's day starts at 19:00 UTC the day before.
  // Karachi midnight of the 1st is therefore still "last month" to a UTC statement
  // window; noon (07:00 UTC) is on the same calendar day, hence the same month, under
  // BOTH readings. (Live "now" postings keep the existing ledger convention.)
  return new Date(vendorDayStart(input).getTime() + VENDOR_NOON_OFFSET_MS);
}

/** 12h after the vendor day's midnight — see resolveAdjustmentEffectiveDate. */
const VENDOR_NOON_OFFSET_MS = 12 * 60 * 60 * 1000;
