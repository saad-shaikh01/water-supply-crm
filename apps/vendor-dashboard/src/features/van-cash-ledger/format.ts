/**
 * Shared display formatting for the Cash Ledger UI (P1). Every ledger
 * component formats money / dates through here so the page reads consistently.
 * All dates are shown in the vendor timezone (Asia/Karachi), matching how the
 * server buckets days.
 */

const TZ = 'Asia/Karachi';

/** `₨ 12,500` — magnitude only (callers add the sign so "−" / "+" stays explicit and never colour-only). */
export const money = (n: number | null | undefined): string =>
  `₨ ${Math.abs(Number(n ?? 0)).toLocaleString('en-PK', { maximumFractionDigits: 2 })}`;

/** Zero renders as an em dash in statements and tables. */
export const moneyOrDash = (n: number | null | undefined): string =>
  !n ? '—' : money(n);

/** `+ ₨ 1,200` / `− ₨ 1,200`. Zero => `₨ 0`. */
export const signedMoney = (n: number | null | undefined): string => {
  const v = Number(n ?? 0);
  if (v === 0) return money(0);
  return `${v < 0 ? '−' : '+'} ${money(v)}`;
};

/** Business date, e.g. `8 Jul 2026`. */
export const fmtDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric', timeZone: TZ });

/** Recorded-at, e.g. `8 Jul, 6:10 pm`. */
export const fmtDateTime = (iso: string): string =>
  new Date(iso).toLocaleString('en-PK', {
    day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: TZ,
  });

/** `YYYY-MM-DD` (PKT day key from `meta.dayStatements`) → `Wed, 8 Jul 2026`. */
export const fmtDayKey = (dayKey: string): string => {
  const [y, m, d] = dayKey.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-PK', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
};

/** PKT day key (`YYYY-MM-DD`) an ISO instant falls in — the key used by `meta.dayStatements`. */
export const pktDayKey = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ });
