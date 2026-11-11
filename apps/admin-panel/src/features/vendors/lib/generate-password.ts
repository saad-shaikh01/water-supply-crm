const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGITS = '23456789';
const SYMBOLS = '!@#$%&*?';

function randomInt(max: number): number {
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / max) * max;
  do {
    globalThis.crypto.getRandomValues(buf);
  } while (buf[0] >= limit);
  return buf[0] % max;
}

const pick = (set: string) => set[randomInt(set.length)];

/** Cryptographically random password with at least one of each class (passes the API's letter+digit rule). */
export function generateStrongPassword(length = 16): string {
  const all = LOWER + UPPER + DIGITS + SYMBOLS;
  const chars = [pick(LOWER), pick(UPPER), pick(DIGITS), pick(SYMBOLS)];
  while (chars.length < length) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}
