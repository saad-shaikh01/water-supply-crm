const SENSITIVE_KEY = /password|token|secret|hash/i;

/** Deep-copies `value`, replacing the value of any key that looks sensitive. Never mutates the input. */
export function redactSensitive(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[…]';
  if (Array.isArray(value)) return value.map((v) => redactSensitive(v, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SENSITIVE_KEY.test(k) ? '[redacted]' : redactSensitive(v, depth + 1)]),
    );
  }
  return value;
}
