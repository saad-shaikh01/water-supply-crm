import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'crypto';
import { getJwtSecret } from '../jwt-secret';

/**
 * AES-256-GCM encryption for TOTP secrets at rest + keyed hashing for recovery codes.
 * Key: ADMIN_2FA_ENC_KEY = base64 of 32 random bytes. Production refuses to run without it;
 * outside production a key is derived from the JWT secret so local runs/tests work.
 */
const VERSION = 'v1';

export function getTwoFactorKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  const raw = env['ADMIN_2FA_ENC_KEY'];
  if (!raw) {
    if (env['NODE_ENV'] === 'production') {
      throw new Error('ADMIN_2FA_ENC_KEY must be set (base64, 32 bytes) in production.');
    }
    return createHash('sha256').update(`dev-2fa:${getJwtSecret(env)}`).digest();
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('ADMIN_2FA_ENC_KEY must be base64 encoding of exactly 32 bytes.');
  }
  return key;
}

export function encryptSecret(plain: string, key: Buffer = getTwoFactorKey()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':');
}

export function decryptSecret(payload: string, key: Buffer = getTwoFactorKey()): string {
  const [v, iv, tag, ct] = payload.split(':');
  if (v !== VERSION || !iv || !tag || !ct) throw new Error('Unsupported secret format');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64')), decipher.final()]).toString('utf8');
}

/** HMAC-SHA256 hex of a normalised recovery code. */
export function hashRecoveryCode(code: string, key: Buffer = getTwoFactorKey()): string {
  return createHmac('sha256', key).update(code).digest('hex');
}
