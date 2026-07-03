/**
 * Phone formatting rules (user requirement):
 * - digits ONLY — no +, -, spaces, parentheses
 * - ALWAYS includes the country code (92 = Pakistan default)
 *
 * Examples:
 *   "0300-1234567"    → "923001234567"
 *   "+92 300 1234567" → "923001234567"
 *   "00923001234567"  → "923001234567"
 *   "3001234567"      → "923001234567"
 *   "-" / "n/a"       → "" (not sendable)
 */
export function normalizePhone(phone: string | null | undefined): string {
  if (!phone) return '';
  let digits = phone.replace(/\D/g, '');
  digits = digits.replace(/^0+(?=92)/, ''); // 0092… → 92…
  if (digits.startsWith('92')) return digits;
  if (digits.startsWith('0')) return `92${digits.slice(1)}`; // 03xx… → 923xx…
  if (digits.length === 10 && digits.startsWith('3')) return `92${digits}`; // 3xx… → 923xx…
  return digits;
}

/** Sendable = normalizes to a plausible full international number */
export function isSendablePhone(phone: string | null | undefined): boolean {
  const normalized = normalizePhone(phone);
  return /^\d{11,15}$/.test(normalized);
}
