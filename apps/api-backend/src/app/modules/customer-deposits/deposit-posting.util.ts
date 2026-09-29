import { BadRequestException } from '@nestjs/common';
import { DepositEntryDirection, DepositType } from '@prisma/client';
import { isFutureVendorDate, vendorDateString, vendorDayStart } from '../../common/helpers/date.util';

const PAISE = 100;

/**
 * CASH amounts are Rs. (up to 2dp, same discipline as
 * adjustment-posting.util's normalizeAdjustmentAmount). BOTTLE amounts are a
 * plain bottle count — no cash value, per the owner-locked decision — so must
 * be a positive whole number.
 */
export function normalizeDepositAmount(type: DepositType, amount: number): number {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    throw new BadRequestException('Amount must be a positive number.');
  }
  if (type === DepositType.BOTTLE) {
    if (!Number.isInteger(amount)) {
      throw new BadRequestException('A bottle deposit amount must be a whole number of bottles.');
    }
    return amount;
  }
  const paise = Math.round(amount * PAISE);
  // Compare in paise: `amount * 100` is inexact in binary floating point
  // (e.g. 1.1 * 100 = 110.00000000000001), so allow a tiny epsilon before
  // declaring "more than 2 decimal places".
  if (Math.abs(amount * PAISE - paise) > 1e-6) {
    throw new BadRequestException('Amount can have at most 2 decimal places.');
  }
  return paise / PAISE;
}

/** Business date (vendor timezone) — defaults to now, cannot be in the future. */
export function resolveDepositEffectiveDate(input: string | undefined, now: Date = new Date()): Date {
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
  return dayStr === todayStr ? now : vendorDayStart(input);
}

/**
 * The signed contribution of an entry to CustomerDeposit.balance. COLLECT
 * adds to the held liability; REFUND and WRITE_OFF both reduce it (the
 * difference between the two is only whether cash/bottles physically moved
 * back to the customer — write-off has none).
 */
export function signedDepositAmount(direction: DepositEntryDirection, amount: number): number {
  return direction === DepositEntryDirection.COLLECT ? amount : -amount;
}

/**
 * What a void's reversal entry's direction should be, so its signed
 * contribution exactly cancels the original (see signedDepositAmount).
 * REFUND and WRITE_OFF both reverse to COLLECT (reinstating the balance);
 * COLLECT reverses to REFUND.
 */
export function oppositeDepositDirection(direction: DepositEntryDirection): DepositEntryDirection {
  return direction === DepositEntryDirection.COLLECT
    ? DepositEntryDirection.REFUND
    : DepositEntryDirection.COLLECT;
}
