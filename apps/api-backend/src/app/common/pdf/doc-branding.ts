/**
 * The resolved, render-ready company identity every customer-facing PDF (statement, delivery
 * receipt, salary slip, daily sheet) is drawn from — see docs/features/multi-vendor-branding-and-whatsapp.md §4.
 * Built by `VendorBrandingService.resolveForDocs()` from the vendor's `VendorBranding` row.
 *
 * Rules the renderers rely on:
 *  - A missing field means "omit that element" — never fall back to another vendor's value.
 *  - `logo` / `icon`: a Buffer (PNG/JPEG downloaded from storage), the string 'builtin' (each
 *    service substitutes its own bundled Blue Ice asset — Dasani only), or null (none).
 */
export type PaymentAccountKind = 'BANK' | 'EASYPAISA' | 'JAZZCASH' | 'RAAST';

export interface PaymentAccount {
  kind: PaymentAccountKind;
  accountTitle: string;
  accountNumber: string;
  bankName?: string | null;
  iban?: string | null;
  branch?: string | null;
  note?: string | null;
}

export type BrandImage = Buffer | 'builtin' | null;

export interface DocBranding {
  /** Banner / footer name. */
  name: string;
  /** "Please make all payments to …" */
  payTo: string;
  address?: string | null;
  phones?: string | null;
  email?: string | null;
  website?: string | null;
  /** Pre-formatted tax line, e.g. "NTN: 1234567-8  ·  STRN: 12-34-5678-901-23". */
  taxLine?: string | null;
  logo: BrandImage;
  /** Small mark used for the faint card watermark; renderers fall back to `logo`. */
  icon: BrandImage;
  /** Banner gradient; null = the default Blue Ice gradient. */
  gradient?: { light: string; dark: string } | null;
  /** Ordered; empty = no payment block is printed at all. */
  paymentAccounts: PaymentAccount[];
  /** Optional free-text line under the thank-you message. */
  footerNote?: string | null;
}

/** Vendor with no profile yet: its own name (and address) only — no logo, contacts or payment block. */
export function neutralBranding(name: string, address?: string | null): DocBranding {
  return { name, payTo: name, address: address ?? null, logo: null, icon: null, gradient: null, paymentAccounts: [] };
}

/** Light end of a banner gradient derived from one colour: the colour mixed 55% toward white. */
export function lightenHex(hex: string, amount = 0.55): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Image source for pdfkit: the service's bundled asset path for 'builtin', a Buffer as-is, else null. */
export function imageSource(image: BrandImage, builtinPath: string): Buffer | string | null {
  if (image === 'builtin') return builtinPath;
  return image ?? null;
}
