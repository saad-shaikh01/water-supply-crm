import { z } from 'zod';
import type { CompanyProfilePayload, CompanyProfileView } from './api/company-profile.api';

/** Documents are drawn with standard PDF fonts: English letters, numbers and common symbols only. */
const pdfSafe = z.string().regex(/^[\x20-\x7E\xA0-\xFF]*$/, 'Only English letters, numbers and common symbols are supported on documents');
const colour = z.string().regex(/^(#[0-9a-fA-F]{6})?$/, 'Use a colour like #0d0d5e');

export const paymentAccountSchema = z
  .object({
    kind: z.enum(['BANK', 'EASYPAISA', 'JAZZCASH', 'RAAST']),
    accountTitle: pdfSafe.min(1, 'Account title is required').max(80),
    accountNumber: z.string().regex(/^[0-9A-Za-z\- ]{4,40}$/, '4-40 letters, digits, spaces or dashes'),
    bankName: pdfSafe.max(60),
    iban: z.string().regex(/^([A-Za-z]{2}[0-9]{2}[0-9A-Za-z ]{8,30})?$/, 'IBAN looks invalid (e.g. PK36SCBL0000001123456702)'),
    branch: pdfSafe.max(60),
    note: pdfSafe.max(100),
  })
  .superRefine((a, ctx) => {
    if (a.kind === 'BANK' && !a.bankName.trim()) {
      ctx.addIssue({ code: 'custom', path: ['bankName'], message: 'Bank name is required for a bank account' });
    }
  });

export const companyProfileSchema = z.object({
  displayName: pdfSafe.min(1, 'Company name is required').max(80),
  legalName: pdfSafe.max(120),
  address: pdfSafe.max(200),
  phones: pdfSafe.max(120),
  email: z.string().max(120).refine((v) => v === '' || /^\S+@\S+\.\S+$/.test(v), 'Enter a valid email'),
  website: pdfSafe.max(120),
  ntn: pdfSafe.max(30),
  strn: pdfSafe.max(30),
  primaryColor: colour,
  accentColor: colour,
  invoiceFooter: pdfSafe.max(200),
  paymentAccounts: z.array(paymentAccountSchema).max(6, 'At most 6 payment accounts'),
});

export type CompanyProfileFormValues = z.infer<typeof companyProfileSchema>;

export const emptyAccount = (kind: CompanyProfileFormValues['paymentAccounts'][number]['kind'] = 'BANK', title = ''): CompanyProfileFormValues['paymentAccounts'][number] => ({
  kind,
  accountTitle: title,
  accountNumber: '',
  bankName: '',
  iban: '',
  branch: '',
  note: '',
});

/** Server view -> form defaults (nulls become empty strings; first-time vendors are pre-filled from their own record). */
export function toFormValues(view: CompanyProfileView): CompanyProfileFormValues {
  const b = view.branding;
  return {
    displayName: b?.displayName ?? view.suggested.displayName ?? '',
    legalName: b?.legalName ?? '',
    address: b?.address ?? view.suggested.address ?? '',
    phones: b?.phones ?? '',
    email: b?.email ?? '',
    website: b?.website ?? '',
    ntn: b?.ntn ?? '',
    strn: b?.strn ?? '',
    primaryColor: b?.primaryColor ?? '',
    accentColor: b?.accentColor ?? '',
    invoiceFooter: b?.invoiceFooter ?? '',
    paymentAccounts: (b?.paymentAccounts ?? []).map((a) => ({
      kind: a.kind,
      accountTitle: a.accountTitle,
      accountNumber: a.accountNumber,
      bankName: a.bankName ?? '',
      iban: a.iban ?? '',
      branch: a.branch ?? '',
      note: a.note ?? '',
    })),
  };
}

/** Form -> API payload (identical shape; kept explicit so no extra key ever reaches the whitelist). */
export function toPayload(v: CompanyProfileFormValues): CompanyProfilePayload {
  return {
    displayName: v.displayName,
    legalName: v.legalName,
    address: v.address,
    phones: v.phones,
    email: v.email,
    website: v.website,
    ntn: v.ntn,
    strn: v.strn,
    primaryColor: v.primaryColor,
    accentColor: v.accentColor,
    invoiceFooter: v.invoiceFooter,
    paymentAccounts: v.paymentAccounts.map((a) => ({
      kind: a.kind,
      accountTitle: a.accountTitle,
      accountNumber: a.accountNumber,
      bankName: a.kind === 'BANK' ? a.bankName : '',
      iban: a.kind === 'BANK' ? a.iban : '',
      branch: a.kind === 'BANK' ? a.branch : '',
      note: a.note,
    })),
  };
}

export const MISSING_LABELS: Record<string, string> = {
  displayName: 'Company name',
  address: 'Address',
  phones: 'Phone number',
  paymentAccounts: 'At least one payment account',
};
