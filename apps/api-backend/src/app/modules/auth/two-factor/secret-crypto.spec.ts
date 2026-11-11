import { randomBytes } from 'crypto';
import { decryptSecret, encryptSecret, getTwoFactorKey, hashRecoveryCode } from './secret-crypto';

describe('secret-crypto', () => {
  const key = randomBytes(32);

  it('round-trips', () => {
    expect(decryptSecret(encryptSecret('JBSWY3DPEHPK3PXP', key), key)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('uses a random IV (same plaintext encrypts differently) and never contains plaintext', () => {
    const a = encryptSecret('JBSWY3DPEHPK3PXP', key);
    const b = encryptSecret('JBSWY3DPEHPK3PXP', key);
    expect(a).not.toBe(b);
    expect(a).not.toContain('JBSWY3DPEHPK3PXP');
    expect(a.startsWith('v1:')).toBe(true);
  });

  it('rejects tampered ciphertext and tag', () => {
    const [v, iv, tag, ct] = encryptSecret('secret', key).split(':');
    const flip = (b64: string) => {
      const buf = Buffer.from(b64, 'base64');
      buf[0] ^= 0xff;
      return buf.toString('base64');
    };
    expect(() => decryptSecret([v, iv, tag, flip(ct)].join(':'), key)).toThrow();
    expect(() => decryptSecret([v, iv, flip(tag), ct].join(':'), key)).toThrow();
  });

  it('rejects the wrong key and unknown formats', () => {
    const enc = encryptSecret('secret', key);
    expect(() => decryptSecret(enc, randomBytes(32))).toThrow();
    expect(() => decryptSecret('v9:a:b:c', key)).toThrow();
  });

  describe('getTwoFactorKey', () => {
    it('throws in production when missing', () => {
      expect(() => getTwoFactorKey({ NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(40) } as never)).toThrow(/ADMIN_2FA_ENC_KEY/);
    });
    it('throws for wrong length', () => {
      expect(() => getTwoFactorKey({ ADMIN_2FA_ENC_KEY: Buffer.alloc(16).toString('base64') } as never)).toThrow(/32 bytes/);
    });
    it('accepts a valid 32 byte key', () => {
      expect(getTwoFactorKey({ ADMIN_2FA_ENC_KEY: key.toString('base64') } as never).equals(key)).toBe(true);
    });
    it('derives a stable dev key outside production', () => {
      const env = { NODE_ENV: 'test' } as never;
      expect(getTwoFactorKey(env).equals(getTwoFactorKey(env))).toBe(true);
    });
  });

  it('hashes recovery codes deterministically per key', () => {
    expect(hashRecoveryCode('ABC', key)).toBe(hashRecoveryCode('ABC', key));
    expect(hashRecoveryCode('ABC', key)).not.toBe(hashRecoveryCode('ABC', randomBytes(32)));
  });
});
