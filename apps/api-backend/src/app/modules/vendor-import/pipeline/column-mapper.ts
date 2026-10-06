import { createHash } from 'crypto';
import type { ColumnSuggestion, ImportFieldDef, MappingConfidence, RawRow } from '../import.types';

/**
 * Stage 2a — ColumnMapper. Pure: suggests which file column feeds which field. Never commits
 * anything — the user always confirms. Order of precedence:
 *   saved profile (vendor, then system) → exact/alias → fuzzy → value-pattern hint.
 */

/** Lower-case and strip punctuation: "Cust. Code" → "cust code". */
export function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .replace(/[_\-./\\#:()]+/g, ' ')
    .replace(/[^a-z0-9؀-ۿ ]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Stable fingerprint of a header set — same columns in any order ⇒ same fingerprint. */
export function headerFingerprint(headers: string[]): string {
  const norm = [...new Set(headers.map(normalizeHeader).filter(Boolean))].sort();
  return createHash('sha1').update(norm.join('|')).digest('hex');
}

function bigrams(s: string): string[] {
  const t = s.replace(/ /g, '');
  if (t.length < 2) return [t];
  const out: string[] = [];
  for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2));
  return out;
}

function dice(a: string, b: string): number {
  const A = bigrams(a);
  const B = bigrams(b);
  if (!A.length || !B.length) return 0;
  const counts = new Map<string, number>();
  A.forEach((g) => counts.set(g, (counts.get(g) ?? 0) + 1));
  let hit = 0;
  B.forEach((g) => {
    const c = counts.get(g) ?? 0;
    if (c > 0) {
      hit++;
      counts.set(g, c - 1);
    }
  });
  return (2 * hit) / (A.length + B.length);
}

/** 0..1 similarity between a normalised header and one normalised alias. */
export function similarity(header: string, alias: string): number {
  if (!header || !alias) return 0;
  if (header === alias) return 1;
  const hw = header.split(' ');
  const aw = alias.split(' ');
  // Whole-word containment, e.g. "customer phone number" ⊇ "phone".
  if (aw.every((w) => hw.includes(w)) || hw.every((w) => aw.includes(w))) return 0.85;
  return dice(header, alias) * 0.8;
}

function fieldScore(header: string, field: ImportFieldDef): number {
  const candidates = [field.key, field.label, ...field.aliases].map(normalizeHeader);
  return Math.max(...candidates.map((a) => similarity(header, a)));
}

function confidenceOf(score: number): MappingConfidence | null {
  if (score >= 0.95) return 'high';
  if (score >= 0.7) return 'medium';
  if (score >= 0.55) return 'low';
  return null;
}

/** "Mostly phone-shaped" check used as a last-resort hint for an unmatched column. */
function looksLikePhoneColumn(values: unknown[]): boolean {
  const filled = values.filter((v) => v !== null && v !== '');
  if (filled.length < 3) return false;
  const phoneish = filled.filter((v) => {
    const d = String(v).replace(/\D/g, '');
    return d.length >= 10 && d.length <= 13;
  });
  return phoneish.length / filled.length >= 0.7;
}

export interface SuggestInput {
  headers: string[];
  sampleRows: RawRow[];
  fields: ImportFieldDef[];
  /** Saved profile columnMap (header → fieldKey|null) — wins over everything. */
  profileColumns?: Record<string, string | null>;
}

export function suggestMapping({ headers, sampleRows, fields, profileColumns }: SuggestInput): ColumnSuggestion[] {
  const result = new Map<string, ColumnSuggestion>();
  const taken = new Set<string>();

  if (profileColumns) {
    const byNorm = new Map(Object.entries(profileColumns).map(([h, f]) => [normalizeHeader(h), f]));
    for (const header of headers) {
      const f = byNorm.get(normalizeHeader(header));
      const known = f === null || (f !== undefined && fields.some((x) => x.key === f));
      if (known && (f === null || !taken.has(f))) {
        result.set(header, { header, fieldKey: f ?? null, confidence: 'profile' });
        if (f) taken.add(f);
      }
    }
  }

  // Best (header, field) pairs first, so a strong match is never stolen by a weaker earlier column.
  const pairs: { header: string; field: ImportFieldDef; score: number }[] = [];
  for (const header of headers) {
    if (result.has(header)) continue;
    const nh = normalizeHeader(header);
    for (const field of fields) {
      if (taken.has(field.key)) continue;
      const score = fieldScore(nh, field);
      if (score >= 0.55) pairs.push({ header, field, score });
    }
  }
  pairs.sort((a, b) => b.score - a.score);
  for (const { header, field, score } of pairs) {
    if (result.has(header) || taken.has(field.key)) continue;
    result.set(header, { header, fieldKey: field.key, confidence: confidenceOf(score) });
    taken.add(field.key);
  }

  // Value-pattern hint: an unmatched phone-looking column feeds `phone` if it is still free.
  const phoneField = fields.find((f) => f.type === 'phone');
  if (phoneField && !taken.has(phoneField.key)) {
    for (const header of headers) {
      if (result.has(header)) continue;
      if (looksLikePhoneColumn(sampleRows.map((r) => r[header]))) {
        result.set(header, { header, fieldKey: phoneField.key, confidence: 'low' });
        taken.add(phoneField.key);
        break;
      }
    }
  }

  return headers.map((header) => result.get(header) ?? { header, fieldKey: null, confidence: null });
}
