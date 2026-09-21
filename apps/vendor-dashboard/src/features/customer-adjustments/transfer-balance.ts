/**
 * Balance Transfer — pure logic (no React, no network).
 *
 * Rules mirrored from the backend (source of truth stays the backend):
 *  - amount > 0, ≤ 2 decimal places, ≤ transferableAmount from the preview
 *  - fromCustomerId ≠ toCustomerId
 *  - internalNote max 1 000 chars (optional for transfers)
 *  - referenceNo max 120 chars (optional)
 */

/** Shape of the backend `preview` response (mirrors the transfer service). */
export interface TransferPreviewSource {
  id: string;
  name: string;
  customerCode: string;
  isActive: boolean;
  financialBalance: number;
  /** The most that can be transferred right now (= Math.max(0, financialBalance)). */
  transferableAmount: number;
  pendingDeliveryCount: number;
  heldBottleCount: number;
  heldBottles: { product: string; balance: number }[];
}

export interface TransferPreviewTarget {
  id: string;
  name: string;
  customerCode: string;
  isActive: boolean;
  financialBalance: number;
}

export interface TransferPreviewBlocker {
  code: 'SAME_CUSTOMER' | 'SOURCE_HAS_NO_BALANCE' | 'TARGET_INACTIVE';
  message: string;
}

export interface TransferPreview {
  source: TransferPreviewSource;
  target: TransferPreviewTarget | null;
  canTransfer: boolean;
  blockers: TransferPreviewBlocker[];
}

/** The shape sent to POST /customer-financial-adjustments/transfers. */
export interface CreateBalanceTransferPayload {
  fromCustomerId: string;
  toCustomerId: string;
  amount: number;
  internalNote?: string;
  referenceNo?: string;
  idempotencyKey: string;
}

export interface TransferResult {
  group: { id: string };
  sourceLeg: { adjustment: { id: string; amount: number }; transaction: { id: string } };
  targetLeg: { adjustment: { id: string; amount: number }; transaction: { id: string } };
  sourceBalance: number;
  targetBalance: number;
  idempotentReplay: boolean;
}

export interface VoidTransferResult {
  group: { id: string };
  sourceBalance: number;
  targetBalance: number;
}

// ── Form state ──────────────────────────────────────────────────────────────

export interface TransferFormState {
  /** UUID of the target customer — empty until chosen. */
  toCustomerId: string;
  /**
   * Raw string typed by the user. Pre-filled with the full transferable amount
   * when the preview loads; editable.
   */
  amount: string;
  internalNote: string;
  referenceNo: string;
}

export type TransferFormField = 'toCustomerId' | 'amount' | 'internalNote' | 'referenceNo';
export type TransferFormErrors = Partial<Record<TransferFormField, string>>;

export const NOTE_MAX = 1000;
export const REFERENCE_MAX = 120;

export function emptyTransferForm(): TransferFormState {
  return { toCustomerId: '', amount: '', internalNote: '', referenceNo: '' };
}

/** Returns a positive number or null (same logic as create-adjustment.ts `parseAmount`). */
export function parseTransferAmount(raw: string): number | null {
  if (raw.trim() === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  const paise = Math.round(n * 100);
  if (Math.abs(n * 100 - paise) > 1e-6) return null; // more than 2 decimal places
  return paise >= 1 ? paise / 100 : null;
}

export function validateTransferForm(
  state: TransferFormState,
  preview: TransferPreview | null | undefined,
): TransferFormErrors {
  const errors: TransferFormErrors = {};

  if (!state.toCustomerId) {
    errors.toCustomerId = 'Choose a target customer.';
  }

  if (state.amount.trim() === '') {
    errors.amount = 'Enter an amount.';
  } else {
    const n = parseTransferAmount(state.amount);
    if (n === null) {
      errors.amount = 'Amount must be more than 0 with at most 2 decimal places.';
    } else if (preview?.source && n > preview.source.transferableAmount + 0.005) {
      errors.amount = `Cannot exceed the transferable balance (₨ ${preview.source.transferableAmount.toLocaleString('en-PK', { maximumFractionDigits: 2 })}).`;
    }
  }

  const note = state.internalNote.trim();
  if (note.length > NOTE_MAX) {
    errors.internalNote = `Note can be at most ${NOTE_MAX} characters.`;
  }

  const ref = state.referenceNo.trim();
  if (ref.length > REFERENCE_MAX) {
    errors.referenceNo = `Reference can be at most ${REFERENCE_MAX} characters.`;
  }

  return errors;
}

export function buildTransferPayload(
  fromCustomerId: string,
  state: TransferFormState,
  idempotencyKey: string,
): CreateBalanceTransferPayload {
  const amount = parseTransferAmount(state.amount);
  if (amount === null) throw new Error('buildTransferPayload: invalid amount');
  if (!state.toCustomerId) throw new Error('buildTransferPayload: no target');

  return {
    fromCustomerId,
    toCustomerId: state.toCustomerId,
    amount,
    internalNote: state.internalNote.trim() || undefined,
    referenceNo: state.referenceNo.trim() || undefined,
    idempotencyKey,
  };
}

/** A fresh idempotency key per dialog-open. */
export function newTransferKey(): string {
  const c = typeof globalThis !== 'undefined' ? (globalThis as { crypto?: Crypto }).crypto : undefined;
  return c?.randomUUID ? c.randomUUID() : `tf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
