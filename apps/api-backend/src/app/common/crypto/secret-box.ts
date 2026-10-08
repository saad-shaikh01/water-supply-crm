import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/**
 * AES-256-GCM envelope for secrets stored in the database (vendor WhatsApp access tokens).
 *
 *   WHATSAPP_TOKEN_KEY            current key, 32 bytes as base64 (44 chars) or hex (64 chars)
 *   WHATSAPP_TOKEN_KEY_VERSION    version number of the current key (default 1)
 *   WHATSAPP_TOKEN_KEY_V<n>       an older key, kept only while rows encrypted with it still exist
 *
 * Rotation: set a new WHATSAPP_TOKEN_KEY + bump the VERSION, keep the old one as _V<old>, re-save/rotate
 * the tokens, then drop the old key. The key is never stored in the database or logged.
 */
export interface SealedSecret {
  cipher: string;
  iv: string;
  tag: string;
  keyVersion: number;
}

export class SecretBoxError extends Error {}

function parseKey(raw: string | undefined): Buffer | null {
  if (!raw) return null;
  const v = raw.trim();
  const buf = /^[0-9a-fA-F]{64}$/.test(v) ? Buffer.from(v, 'hex') : Buffer.from(v, 'base64');
  return buf.length === 32 ? buf : null;
}

export function currentKeyVersion(): number {
  const n = parseInt(process.env['WHATSAPP_TOKEN_KEY_VERSION'] ?? '1', 10);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

function keyFor(version: number): Buffer | null {
  return parseKey(version === currentKeyVersion() ? process.env['WHATSAPP_TOKEN_KEY'] : process.env[`WHATSAPP_TOKEN_KEY_V${version}`]);
}

/** True when a valid current key is configured (storing tokens needs it). */
export function secretKeyConfigured(): boolean {
  return !!keyFor(currentKeyVersion());
}

export function sealSecret(plain: string): SealedSecret {
  const version = currentKeyVersion();
  const key = keyFor(version);
  if (!key) throw new SecretBoxError('WHATSAPP_TOKEN_KEY is not configured (32-byte base64 or hex key required)');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return { cipher: enc.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), keyVersion: version };
}

export function openSecret(s: SealedSecret): string {
  const key = keyFor(s.keyVersion);
  if (!key) throw new SecretBoxError(`No key available for key version ${s.keyVersion}`);
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(s.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(s.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(s.cipher, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    // wrong key / tampered data — never echo anything about the content
    throw new SecretBoxError('Stored secret could not be decrypted');
  }
}
