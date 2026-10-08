import { SecretBoxError, currentKeyVersion, openSecret, sealSecret, secretKeyConfigured } from './secret-box';

const KEY_A = Buffer.alloc(32, 7).toString('base64');
const KEY_B = Buffer.alloc(32, 9).toString('hex');
const ENV = ['WHATSAPP_TOKEN_KEY', 'WHATSAPP_TOKEN_KEY_VERSION', 'WHATSAPP_TOKEN_KEY_V1', 'WHATSAPP_TOKEN_KEY_V2'] as const;

describe('secret-box (AES-256-GCM)', () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    ENV.forEach((k) => {
      saved[k] = process.env[k];
      delete process.env[k];
    });
  });
  afterEach(() => {
    ENV.forEach((k) => {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    });
  });

  it('refuses to seal without a valid key, and says why', () => {
    expect(secretKeyConfigured()).toBe(false);
    expect(() => sealSecret('EAAB-token')).toThrow(SecretBoxError);
    process.env['WHATSAPP_TOKEN_KEY'] = 'too-short';
    expect(secretKeyConfigured()).toBe(false);
  });

  it('round-trips a token; ciphertext never contains the plaintext; a fresh IV every time', () => {
    process.env['WHATSAPP_TOKEN_KEY'] = KEY_A;
    const a = sealSecret('EAAB-super-secret-token');
    const b = sealSecret('EAAB-super-secret-token');
    expect(JSON.stringify(a)).not.toContain('super-secret');
    expect(a.iv).not.toBe(b.iv);
    expect(a.cipher).not.toBe(b.cipher);
    expect(openSecret(a)).toBe('EAAB-super-secret-token');
    expect(a.keyVersion).toBe(1);
  });

  it('accepts a hex key too', () => {
    process.env['WHATSAPP_TOKEN_KEY'] = KEY_B;
    expect(openSecret(sealSecret('tok'))).toBe('tok');
  });

  it('detects tampering and a wrong key without leaking anything', () => {
    process.env['WHATSAPP_TOKEN_KEY'] = KEY_A;
    const s = sealSecret('EAAB-token');
    const flipped = { ...s, cipher: Buffer.from(s.cipher, 'base64').map((b, i) => (i === 0 ? b ^ 1 : b)).toString() };
    expect(() => openSecret({ ...s, tag: Buffer.alloc(16, 1).toString('base64') })).toThrow('could not be decrypted');
    expect(() => openSecret(flipped as never)).toThrow(SecretBoxError);
    process.env['WHATSAPP_TOKEN_KEY'] = KEY_B;
    expect(() => openSecret(s)).toThrow('could not be decrypted');
  });

  it('key rotation: old rows stay readable via WHATSAPP_TOKEN_KEY_V<n> while new rows use the new key', () => {
    process.env['WHATSAPP_TOKEN_KEY'] = KEY_A;
    const old = sealSecret('old-token');
    expect(old.keyVersion).toBe(1);

    process.env['WHATSAPP_TOKEN_KEY_V1'] = KEY_A; // keep the old key
    process.env['WHATSAPP_TOKEN_KEY'] = KEY_B; // new current key
    process.env['WHATSAPP_TOKEN_KEY_VERSION'] = '2';
    expect(currentKeyVersion()).toBe(2);
    expect(openSecret(old)).toBe('old-token');
    const fresh = sealSecret('new-token');
    expect(fresh.keyVersion).toBe(2);
    expect(openSecret(fresh)).toBe('new-token');

    delete process.env['WHATSAPP_TOKEN_KEY_V1']; // old key dropped -> old rows unreadable (must be re-saved before this)
    expect(() => openSecret(old)).toThrow(SecretBoxError);
  });
});
