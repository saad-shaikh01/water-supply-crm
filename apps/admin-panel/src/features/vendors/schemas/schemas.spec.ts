import { adminStepSchema, companyStepSchema, createVendorSchema, editVendorSchema } from './index';
import { resetPasswordSchema } from './reset-password';
import { brandingSchema, toBrandingInput, validateBrandingImage } from './branding';
import { redactSensitive } from '../lib/redact';
import { generateStrongPassword } from '../lib/generate-password';

describe('company step', () => {
  it.each(['Acme', 'a b', '-x', 'x-', 'a', 'a--b'])('rejects slug %p', (slug) => {
    expect(companyStepSchema.safeParse({ name: 'Acme', slug }).success).toBe(false);
  });
  it('accepts a good slug and optional address', () => {
    expect(companyStepSchema.safeParse({ name: 'Acme', slug: 'acme-water-2' }).success).toBe(true);
  });
  it('requires a name', () => {
    expect(companyStepSchema.safeParse({ name: ' ', slug: 'acme' }).success).toBe(false);
  });
});

describe('admin step', () => {
  const base = { adminName: 'Jo', adminEmail: 'Jo@Acme.com', adminPassword: 'abcd1234' };
  it('lowercases the email', () => {
    const r = adminStepSchema.safeParse(base);
    expect(r.success && r.data.adminEmail).toBe('jo@acme.com');
  });
  it.each(['abc1234', 'abcdefgh', '12345678', 'a1'.repeat(37)])('rejects password %p', (adminPassword) => {
    expect(adminStepSchema.safeParse({ ...base, adminPassword }).success).toBe(false);
  });
  it('rejects a bad email', () => {
    expect(adminStepSchema.safeParse({ ...base, adminEmail: 'nope' }).success).toBe(false);
  });
  it('full create schema passes with all fields', () => {
    expect(createVendorSchema.safeParse({ ...base, name: 'Acme', slug: 'acme' }).success).toBe(true);
  });
});

describe('edit schema', () => {
  it('output has no slug even if one is supplied', () => {
    const r = editVendorSchema.safeParse({ name: 'Acme', slug: 'acme', address: 'x' });
    expect(r.success).toBe(true);
    expect(r.success && 'slug' in r.data).toBe(false);
  });
});

describe('reset-password schema', () => {
  const ok = { newPassword: 'abcd1234', confirmPassword: 'abcd1234', superAdminPassword: 'me', deliveryAck: true };
  it('accepts a valid payload', () => expect(resetPasswordSchema.safeParse(ok).success).toBe(true));
  it('flags mismatch on confirmPassword', () => {
    const r = resetPasswordSchema.safeParse({ ...ok, confirmPassword: 'other1234' });
    expect(r.success).toBe(false);
    expect(!r.success && r.error.issues[0].path).toEqual(['confirmPassword']);
  });
  it('rejects < 8 chars', () => expect(resetPasswordSchema.safeParse({ ...ok, newPassword: 'ab1', confirmPassword: 'ab1' }).success).toBe(false));
  it('requires the super-admin password', () => expect(resetPasswordSchema.safeParse({ ...ok, superAdminPassword: '' }).success).toBe(false));
  it('requires the delivery acknowledgement', () => expect(resetPasswordSchema.safeParse({ ...ok, deliveryAck: false }).success).toBe(false));
});

describe('branding schema', () => {
  const acct = { kind: 'BANK' as const, accountTitle: 'Acme', accountNumber: '1234-5678', bankName: 'HBL' };
  it('requires bankName for BANK only', () => {
    expect(brandingSchema.safeParse({ displayName: 'A', paymentAccounts: [{ ...acct, bankName: '' }] }).success).toBe(false);
    expect(brandingSchema.safeParse({ displayName: 'A', paymentAccounts: [{ ...acct, kind: 'EASYPAISA', bankName: '' }] }).success).toBe(true);
  });
  it('rejects non-Latin text and bad colours', () => {
    expect(brandingSchema.safeParse({ displayName: 'اردو', paymentAccounts: [] }).success).toBe(false);
    expect(brandingSchema.safeParse({ displayName: 'A', primaryColor: 'red', paymentAccounts: [] }).success).toBe(false);
  });
  it('toBrandingInput turns blanks into null and drops bankName for wallets', () => {
    const v = brandingSchema.parse({ displayName: ' A ', legalName: '', paymentAccounts: [{ ...acct, kind: 'JAZZCASH' }] });
    const out = toBrandingInput(v);
    expect(out.displayName).toBe('A');
    expect(out.legalName).toBeNull();
    expect(out.paymentAccounts[0].bankName).toBeNull();
    expect(out.paymentAccounts[0].iban).toBeNull();
  });
  it('validates image type and size', () => {
    expect(validateBrandingImage({ size: 10, type: 'image/png' })).toBeNull();
    expect(validateBrandingImage({ size: 10, type: 'image/gif' })).toMatch(/PNG/);
    expect(validateBrandingImage({ size: 2 * 1024 * 1024, type: 'image/png' })).toMatch(/1 MB/);
  });
});

describe('helpers', () => {
  it('redactSensitive hides password/token/secret/hash keys deeply without mutating', () => {
    const input = { before: { passwordHash: 'h', name: 'a' }, after: [{ accessToken: 't', apiSecret: 's', ok: 1 }] };
    const out = redactSensitive(input) as typeof input;
    expect(out.before.passwordHash).toBe('[redacted]');
    expect(out.before.name).toBe('a');
    expect((out.after[0] as Record<string, unknown>).accessToken).toBe('[redacted]');
    expect((out.after[0] as Record<string, unknown>).apiSecret).toBe('[redacted]');
    expect(input.before.passwordHash).toBe('h');
  });
  it('generated passwords satisfy the API rule', () => {
    for (let i = 0; i < 20; i++) {
      const p = generateStrongPassword();
      expect(p.length).toBeGreaterThanOrEqual(8);
      expect(adminStepSchema.shape.adminPassword.safeParse(p).success).toBe(true);
    }
  });
});
