import { ADJUSTMENT_KIND_POLICY, type AdjustmentDirection } from '@water-supply-crm/types';
import { pktToday, startOfMonthYmd } from '../../lib/date-pkt';
import type { CreateAdjustmentPayload, PostableAdjustmentKind } from './api/customer-adjustments.api';

/**
 * Pure logic behind the create dialog (no React, no network) so the rules that mirror the backend
 * are unit-tested on their own. The backend stays authoritative for every one of them.
 */

// Same limits as the backend DTO.
export const TITLE_MAX = 120;
export const NOTE_MAX = 1000;
export const REFERENCE_MAX = 120;

export interface CreateFormState {
  kind: PostableAdjustmentKind | '';
  /** Only used by CORRECTION — every other kind's direction is fixed by the backend. */
  direction: AdjustmentDirection | '';
  amount: string;
  title: string;
  internalNote: string;
  referenceNo: string;
  /** YYYY-MM-DD, vendor (Karachi) calendar day. */
  effectiveDate: string;
}

export type CreateFormField = 'kind' | 'direction' | 'amount' | 'title' | 'internalNote' | 'effectiveDate';
export type CreateFormErrors = Partial<Record<CreateFormField, string>>;

export const emptyCreateForm = (kind: PostableAdjustmentKind | '', today = pktToday()): CreateFormState => ({
  kind,
  direction: '',
  amount: '',
  title: '',
  internalNote: '',
  referenceNo: '',
  effectiveDate: today,
});

/**
 * The direction this form will post with, or `null` while it is not decided yet (a CORRECTION with
 * no choice). Fixed kinds always resolve from the policy table — the user never picks one.
 */
export function resolveFormDirection(state: Pick<CreateFormState, 'kind' | 'direction'>): AdjustmentDirection | null {
  if (!state.kind) return null;
  const fixed = ADJUSTMENT_KIND_POLICY[state.kind].direction;
  if (fixed === 'CHARGE' || fixed === 'CREDIT') return fixed;
  return state.direction || null; // 'EITHER' (CORRECTION) → the user's choice
}

/** Earliest / latest date the backend accepts: the start of the current month … today (Karachi). */
export const dateBounds = (today = pktToday()) => ({ min: startOfMonthYmd(today), max: today });

/** The typed amount as a number, or `null` if it isn't a positive number with at most 2 decimals. */
export function parseAmount(raw: string): number | null {
  if (raw.trim() === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  const paise = Math.round(n * 100);
  if (Math.abs(n * 100 - paise) > 1e-6) return null; // more than 2 decimal places
  return paise >= 1 ? paise / 100 : null;
}

export function validateCreateForm(state: CreateFormState, today = pktToday()): CreateFormErrors {
  const errors: CreateFormErrors = {};

  if (!state.kind) {
    errors.kind = 'Choose a type.';
    return errors;
  }
  const policy = ADJUSTMENT_KIND_POLICY[state.kind];

  if (policy.direction === 'EITHER' && !state.direction) {
    errors.direction = 'Say whether this raises or lowers what the customer owes.';
  }

  if (state.amount.trim() === '') {
    errors.amount = 'Enter an amount.';
  } else if (parseAmount(state.amount) === null) {
    errors.amount = 'Amount must be more than 0 with at most 2 decimal places.';
  }

  const title = state.title.trim();
  if (!title) errors.title = 'Enter a title.';
  else if (title.length > TITLE_MAX) errors.title = `Title can be at most ${TITLE_MAX} characters.`;

  const note = state.internalNote.trim();
  if (policy.requiresInternalNote && !note) {
    errors.internalNote = 'An internal note is required — record why this balance is being reduced or rewritten.';
  } else if (note.length > NOTE_MAX) {
    errors.internalNote = `Note can be at most ${NOTE_MAX} characters.`;
  }

  const { min, max } = dateBounds(today);
  if (!state.effectiveDate) errors.effectiveDate = 'Choose a date.';
  else if (state.effectiveDate > max) errors.effectiveDate = 'The date cannot be in the future.';
  else if (state.effectiveDate < min) errors.effectiveDate = 'The date must be within the current month.';

  return errors;
}

/**
 * The request body. `direction` is sent ONLY for CORRECTION (where the backend requires it); for
 * every other kind the backend decides, so the client never asserts one. `effectiveDate` is omitted
 * for today — the backend then stamps the real posting moment.
 */
export function buildCreatePayload(
  customerId: string,
  state: CreateFormState,
  idempotencyKey: string,
  today = pktToday(),
): CreateAdjustmentPayload {
  if (!state.kind) throw new Error('buildCreatePayload: no kind chosen');
  const amount = parseAmount(state.amount);
  if (amount === null) throw new Error('buildCreatePayload: invalid amount');

  return {
    customerId,
    kind: state.kind,
    ...(ADJUSTMENT_KIND_POLICY[state.kind].direction === 'EITHER' && state.direction
      ? { direction: state.direction }
      : {}),
    amount,
    title: state.title.trim(),
    internalNote: state.internalNote.trim() || undefined,
    referenceNo: state.referenceNo.trim() || undefined,
    effectiveDate: state.effectiveDate && state.effectiveDate !== today ? state.effectiveDate : undefined,
    idempotencyKey,
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The customer's balance after posting: a charge raises what they owe, a credit lowers it. */
export const balanceAfter = (balance: number, direction: AdjustmentDirection, amount: number): number =>
  round2(direction === 'CHARGE' ? balance + amount : balance - amount);

/** A balance in words — positive = the customer owes, negative = they are in credit. */
export function describeBalance(balance: number): string {
  const n = round2(balance);
  const money = `₨ ${Math.abs(n).toLocaleString('en-PK', { maximumFractionDigits: 2 })}`;
  return n > 0 ? `${money} owed` : n < 0 ? `${money} credit` : '₨ 0 (settled)';
}

/** A fresh key per dialog-open. `randomUUID` needs a secure context — fall back so it never throws. */
export function newIdempotencyKey(): string {
  const c = typeof globalThis !== 'undefined' ? (globalThis as { crypto?: Crypto }).crypto : undefined;
  return c?.randomUUID ? c.randomUUID() : `adj-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
