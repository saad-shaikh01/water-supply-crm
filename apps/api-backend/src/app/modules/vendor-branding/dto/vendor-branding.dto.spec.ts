import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpsertVendorBrandingDto } from './vendor-branding.dto';

const valid = {
  displayName: 'Lorem Water',
  address: 'Lahore',
  phones: '0300-1111111',
  paymentAccounts: [{ kind: 'BANK', accountTitle: 'Lorem', bankName: 'HBL', accountNumber: '1234-5678' }],
};

async function errorsFor(plain: Record<string, unknown>) {
  // same options as main.ts
  const dto = plainToInstance(UpsertVendorBrandingDto, plain, { enableImplicitConversion: true });
  const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
  const flat = (es: typeof errors, prefix = ''): string[] =>
    es.flatMap((e) => [...(e.constraints ? [`${prefix}${e.property}`] : []), ...flat(e.children ?? [], `${prefix}${e.property}.`)]);
  return { dto, props: flat(errors) };
}

describe('UpsertVendorBrandingDto', () => {
  it('accepts a complete profile', async () => {
    expect((await errorsFor(valid)).props).toEqual([]);
  });

  it('trims text, turns blank optional fields into null and upper-cases IBAN', async () => {
    const { dto, props } = await errorsFor({
      ...valid,
      displayName: '  Lorem Water  ',
      legalName: '   ',
      paymentAccounts: [{ kind: 'BANK', accountTitle: 'Lorem', bankName: 'HBL', accountNumber: '1234-5678', iban: 'pk36scbl0000001123456702', branch: '' }],
    });
    expect(props).toEqual([]);
    expect(dto.displayName).toBe('Lorem Water');
    expect(dto.legalName).toBeNull();
    expect(dto.paymentAccounts[0].iban).toBe('PK36SCBL0000001123456702');
    expect(dto.paymentAccounts[0].branch).toBeNull();
  });

  it('requires a display name and an array of accounts (may be empty)', async () => {
    expect((await errorsFor({ ...valid, displayName: '' })).props).toContain('displayName');
    expect((await errorsFor({ ...valid, paymentAccounts: [] })).props).toEqual([]);
    expect((await errorsFor({ displayName: 'X' })).props).toContain('paymentAccounts');
  });

  it('a bank account needs a bank name; wallet accounts do not', async () => {
    expect((await errorsFor({ ...valid, paymentAccounts: [{ kind: 'BANK', accountTitle: 'L', accountNumber: '1234' }] })).props).toContain('paymentAccounts.0.bankName');
    expect((await errorsFor({ ...valid, paymentAccounts: [{ kind: 'EASYPAISA', accountTitle: 'L', accountNumber: '03001234567' }] })).props).toEqual([]);
  });

  it('rejects text the PDF fonts cannot print (Urdu, emoji) with a clear failure', async () => {
    expect((await errorsFor({ ...valid, displayName: 'لوریم واٹر' })).props).toContain('displayName');
    expect((await errorsFor({ ...valid, address: 'Lahore 💧' })).props).toContain('address');
  });

  it('validates colours, email, IBAN, account number and kind', async () => {
    expect((await errorsFor({ ...valid, primaryColor: 'blue' })).props).toContain('primaryColor');
    expect((await errorsFor({ ...valid, primaryColor: '#0a1B2c' })).props).toEqual([]);
    expect((await errorsFor({ ...valid, email: 'nope' })).props).toContain('email');
    expect((await errorsFor({ ...valid, paymentAccounts: [{ kind: 'BANK', accountTitle: 'L', bankName: 'HBL', accountNumber: '12' }] })).props).toContain('paymentAccounts.0.accountNumber');
    expect((await errorsFor({ ...valid, paymentAccounts: [{ kind: 'BANK', accountTitle: 'L', bankName: 'HBL', accountNumber: '1234', iban: 'bad iban!' }] })).props).toContain('paymentAccounts.0.iban');
    expect((await errorsFor({ ...valid, paymentAccounts: [{ kind: 'CRYPTO', accountTitle: 'L', accountNumber: '1234' }] })).props).toContain('paymentAccounts.0.kind');
  });

  it('caps the number of accounts at 6 and forbids unknown properties', async () => {
    const seven = Array.from({ length: 7 }, () => ({ kind: 'RAAST', accountTitle: 'L', accountNumber: '03001234567' }));
    expect((await errorsFor({ ...valid, paymentAccounts: seven })).props).toContain('paymentAccounts');
    expect((await errorsFor({ ...valid, vendorId: 'someone-else' })).props).toContain('vendorId');
  });
});
