import { InternalServerErrorException } from '@nestjs/common';
import { ADJUSTMENT_KIND_POLICY, type AdjustmentDirection } from '@water-supply-crm/types';

/**
 * Pure helpers for balance transfers (no DB, no Nest providers) — unit-tested through
 * the transfer service spec. Amount / direction / sign helpers are shared with the
 * single-customer posting engine in adjustment-posting.util.ts and are not repeated here.
 */

/**
 * Half a paisa. Balances are Float and are moved by increments, so a balance that is
 * "100.10" to the operator may be stored as 100.09999999999999. The source-balance
 * guard therefore compares against `amount - EPSILON`, which is exact for whole-paise
 * money and tolerates float noise (the write-off cap uses the same round-to-paise idea).
 */
export const TRANSFER_BALANCE_EPSILON = 0.005;

/** What the SOURCE customer reads. Customer CODES only — never the other party's name. */
export const transferOutTitle = (targetCode: string) => `Balance transferred to ${targetCode}`;

/** What the TARGET customer reads. Customer CODES only — never the other party's name. */
export const transferInTitle = (sourceCode: string) => `Balance transferred from ${sourceCode}`;

/** Whole paise (money is Float platform-wide; invariants are compared in paise). */
export const toPaise = (n: number) => Math.round(n * 100);

/**
 * The fixed direction of a transfer leg, read from the kind policy so the two can never
 * drift (TRANSFER_OUT is a CREDIT on the source, TRANSFER_IN a CHARGE on the target).
 */
export function transferLegDirection(kind: 'TRANSFER_OUT' | 'TRANSFER_IN'): AdjustmentDirection {
  const direction = ADJUSTMENT_KIND_POLICY[kind].direction;
  if (direction === 'EITHER' || direction === 'DERIVED') {
    throw new InternalServerErrorException(`Transfer leg ${kind} has no fixed direction.`);
  }
  return direction;
}

/**
 * The transfer invariant: the two ledger rows of a transfer (or of its reversal) net to
 * exactly zero, so money moves between accounts and is neither created nor destroyed.
 * Thrown INSIDE the database transaction, so a violation rolls everything back.
 */
export function assertLegsNetZero(ledgerAmounts: readonly number[]): void {
  const net = ledgerAmounts.reduce((sum, a) => sum + toPaise(a), 0);
  if (net !== 0) {
    throw new InternalServerErrorException(
      `Transfer legs do not net to zero (${net} paise). Nothing was posted.`,
    );
  }
}

/**
 * Both customers' rows are always written in this order, whichever is the source. Two
 * opposite transfers (A→B and B→A) racing then take their row locks in the same order
 * and cannot deadlock. Any deterministic total order works; plain string order is used.
 */
export function customerLockOrder(a: string, b: string): [string, string] {
  return a <= b ? [a, b] : [b, a];
}
