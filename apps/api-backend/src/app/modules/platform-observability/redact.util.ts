/**
 * Defence-in-depth redaction for anything shown to the platform observer.
 * Historical audit rows / queue errors may contain secrets; mask them on the way out.
 */
export const SENSITIVE_KEY_RE = /password|token|secret|cipher|otp|authorization|pin/i;
export const REDACTED = '[REDACTED]';
const MAX_DEPTH = 12;

export function redactSensitive(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '[TRUNCATED]';
  if (Array.isArray(value)) return value.map((v) => redactSensitive(v, depth + 1));
  if (value instanceof Date) return value.toISOString();
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEY_RE.test(k) ? REDACTED : redactSensitive(v, depth + 1);
  }
  return out;
}

/** Strip bearer tokens, token-like query params and credentials embedded in URLs from free text. */
export function redactText(text: string | null | undefined, maxLen = 300): string | null {
  if (text == null) return null;
  let s = String(text)
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/\b(access_token|token|api_key|apikey|password|secret)=[^\s&"']+/gi, '$1=[REDACTED]')
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+(?::[^\s/@]*)?@/gi, '$1[REDACTED]@');
  if (s.length > maxLen) s = s.slice(0, maxLen);
  return s;
}
