import { ADJUSTMENT_KIND_POLICY, type AdjustmentDirection, type AdjustmentKind } from '@water-supply-crm/types';
import { PKT_TIME_ZONE } from '../../lib/date-pkt';

/** Staff-facing name of a kind, from the shared policy table (falls back to the raw enum value). */
export const adjustmentKindLabel = (kind: AdjustmentKind): string => ADJUSTMENT_KIND_POLICY[kind]?.label ?? kind;

/** `₨ 1,250.5` — unsigned; the sign is shown separately (see `directionSign`). */
export const fmtAdjustmentAmount = (n: number | null | undefined): string =>
  `₨ ${Math.abs(Number(n ?? 0)).toLocaleString('en-PK', { maximumFractionDigits: 2 })}`;

/** CHARGE raises what the customer owes (+), CREDIT lowers it (−). Same convention as the Transactions tab. */
export const directionSign = (direction: AdjustmentDirection): '+' | '−' => (direction === 'CHARGE' ? '+' : '−');

// Dates are shown in the vendor's calendar (Asia/Karachi), not the browser's, so a row's day
// always matches the day the backend filters and the statement use.
export const fmtAdjustmentDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric', timeZone: PKT_TIME_ZONE });

export const fmtAdjustmentDateTime = (iso: string): string =>
  new Date(iso).toLocaleString('en-PK', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: PKT_TIME_ZONE,
  });
