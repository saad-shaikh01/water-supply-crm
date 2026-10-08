import type { SlipEntryStatus, SlipDeliveryStatus } from '../api/payroll.api';

/** Pure helpers for the salary-slip UI (no React, no app imports) — easy to unit test. */

/** Mirrors the backend `SLIP_ELIGIBLE_STATUSES`: a slip is only sent once final payable is settled on. */
export const SLIP_ELIGIBLE_STATUSES = ['APPROVED', 'LOCKED', 'SETTLED'] as const;

/** Above this many slips the dialog nudges the admin to send a small batch first (WhatsApp warm-up lesson). */
export const SLIP_WARMUP_THRESHOLD = 20;
/** Size of the "send a small batch first" option. */
export const SLIP_WARMUP_BATCH = 20;

export function isSlipEligibleStatus(status: string): boolean {
  return (SLIP_ELIGIBLE_STATUSES as readonly string[]).includes(status);
}

/** Why a row's "Send slip" is disabled; null when the entry's status allows it. */
export function slipDisabledReason(status: string): string | null {
  return isSlipEligibleStatus(status) ? null : 'Final payable is not set yet — approve this entry first.';
}

export type SlipChipTone = 'ok' | 'warn' | 'bad' | 'info';

export interface SlipChip {
  label: string;
  tone: SlipChipTone;
  title?: string;
}

function shortDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

const FAILURE_LABEL: Record<Exclude<SlipDeliveryStatus, 'SENT' | 'QUEUED' | 'SENDING'>, string> = {
  FAILED: 'Slip failed',
  SKIPPED_NO_PHONE: 'No phone',
  SKIPPED_DISCONNECTED: 'Not sent (WhatsApp offline)',
};

/** The small "slip sent / failed / sending" chip shown on a row, or null when no slip was ever attempted. */
export function slipChip(status: SlipEntryStatus | undefined): SlipChip | null {
  const last = status?.last;
  if (!last) return null;
  if (last.status === 'QUEUED' || last.status === 'SENDING') return { label: 'Sending…', tone: 'info' };

  if (last.status === 'SENT') {
    const changed = status?.lastSent?.amountChanged;
    return changed
      ? { label: `Sent ${shortDate(last.at)} · amount changed`, tone: 'warn', title: 'The payable changed after this slip was sent.' }
      : { label: `Slip sent ${shortDate(last.at)}`, tone: 'ok' };
  }

  const base = FAILURE_LABEL[last.status];
  const earlier = status?.lastSent ? ` · sent earlier ${shortDate(status.lastSent.at)}` : '';
  return { label: `${base}${earlier}`, tone: 'bad', title: last.error ?? undefined };
}

/** `45000` → `45,000`. */
export const formatRupees = (n: number) => Math.round(n).toLocaleString('en-US');
