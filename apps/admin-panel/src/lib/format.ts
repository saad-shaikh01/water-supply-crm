export function formatNumber(n: number | string | null | undefined): string {
  const v = Number(n);
  return Number.isFinite(v) ? v.toLocaleString('en-US') : '0';
}

export function formatCurrency(n: number | string | null | undefined): string {
  return `Rs. ${formatNumber(n)}`;
}

/** Signed percent, e.g. +12%, -5%, 0%. */
export function formatPercent(n: number | string | null | undefined): string {
  const v = Number(n);
  if (!Number.isFinite(v) || v === 0) return '0%';
  const rounded = Math.round(v * 10) / 10;
  return `${rounded > 0 ? '+' : ''}${rounded}%`;
}
