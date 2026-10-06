import { createHash } from 'crypto';
import type { ImportMapping, PlannedRow } from '../import.types';

/**
 * The plan fingerprint. `execute` must echo it, so the vendor can only confirm exactly what
 * they previewed: any change to mapping, options or the resulting rows makes the hash differ
 * (409 PLAN_STALE). Deterministic — same input, same hash — and independent of row object key
 * order.
 */
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, stable(v)]),
    );
  }
  return value;
}

export function computePlanHash(planned: PlannedRow<unknown>[], mapping: ImportMapping, options: unknown): string {
  const body = [...planned]
    .sort((a, b) => a.rowNumber - b.rowNumber)
    .map((p) => [p.rowNumber, p.action, stable(p.normalized)]);
  return createHash('sha256')
    .update(JSON.stringify({ mapping: stable(mapping), options: stable(options), rows: body }))
    .digest('hex');
}
