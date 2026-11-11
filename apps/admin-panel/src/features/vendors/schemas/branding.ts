import { z } from 'zod';

/** Documents are drawn with standard PDF fonts: only Latin-1 text prints correctly (mirrors the API's PDF_SAFE). */
const PDF_SAFE = /^[\x20-\x7E\xA0-\xFF]*$/;
const pdfSafe = 'Only English letters, numbers and common symbols are supported on documents';
const COLOR = /^#[0-9a-fA-F]{6}$/;

const optText = (max: number) => z.string().trim().max(max, `At most ${max} characters`).regex(PDF_SAFE, pdfSafe).optional();

export const paymentAccountSchema = z
  .object({
    kind: z.enum(['BANK', 'EASYPAISA', 'JAZZCASH', 'RAAST']),
    accountTitle: z.string().trim().min(1, 'Account title is required').max(80).regex(PDF_SAFE, pdfSafe),
    accountNumber: z.string().trim().regex(/^[0-9A-Za-z\- ]{4,40}$/, 'Account number must be 4-40 letters, digits, spaces or dashes'),
    bankName: optText(60),
    iban: z
      .string()
      .trim()
      .optional()
      .refine((v) => !v || /^[A-Za-z]{2}[0-9]{2}[0-9A-Za-z ]{8,30}$/.test(v), 'IBAN looks invalid (e.g. PK36SCBL0000001123456702)'),
    branch: optText(60),
    note: optText(100),
  })
  .refine((a) => a.kind !== 'BANK' || !!a.bankName, { path: ['bankName'], message: 'Bank name is required for a bank account' });

export const brandingSchema = z.object({
  displayName: z.string().trim().min(1, 'Display name is required').max(80, 'At most 80 characters').regex(PDF_SAFE, pdfSafe),
  legalName: optText(120),
  address: optText(200),
  phones: optText(120),
  email: z
    .string()
    .trim()
    .max(120)
    .optional()
    .refine((v) => !v || z.string().email().safeParse(v).success, 'Valid email required'),
  website: optText(120),
  ntn: optText(30),
  strn: optText(30),
  primaryColor: z.string().trim().optional().refine((v) => !v || COLOR.test(v), 'Use a #RRGGBB colour'),
  accentColor: z.string().trim().optional().refine((v) => !v || COLOR.test(v), 'Use a #RRGGBB colour'),
  invoiceFooter: optText(200),
  paymentAccounts: z.array(paymentAccountSchema).max(6, 'At most 6 payment accounts'),
});

export type BrandingFormValues = z.infer<typeof brandingSchema>;

export const IMAGE_MAX_BYTES = 1024 * 1024;
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

/** Client-side image check; returns an error message or null. */
export function validateBrandingImage(file: { size: number; type: string }): string | null {
  if (!IMAGE_TYPES.includes(file.type)) return 'Use a PNG, JPG or WebP image.';
  if (file.size > IMAGE_MAX_BYTES) return 'The image must be 1 MB or smaller.';
  return null;
}

/** Form values -> API body: '' becomes null so optional fields can be cleared; BANK-only fields are dropped for wallets. */
export function toBrandingInput(v: BrandingFormValues) {
  const n = (s?: string) => (s && s.trim() ? s.trim() : null);
  return {
    displayName: v.displayName.trim(),
    legalName: n(v.legalName),
    address: n(v.address),
    phones: n(v.phones),
    email: n(v.email),
    website: n(v.website),
    ntn: n(v.ntn),
    strn: n(v.strn),
    primaryColor: n(v.primaryColor),
    accentColor: n(v.accentColor),
    invoiceFooter: n(v.invoiceFooter),
    paymentAccounts: v.paymentAccounts.map((a) => ({
      kind: a.kind,
      accountTitle: a.accountTitle.trim(),
      accountNumber: a.accountNumber.trim(),
      bankName: a.kind === 'BANK' ? n(a.bankName) : null,
      iban: n(a.iban)?.toUpperCase() ?? null,
      branch: n(a.branch),
      note: n(a.note),
    })),
  };
}
