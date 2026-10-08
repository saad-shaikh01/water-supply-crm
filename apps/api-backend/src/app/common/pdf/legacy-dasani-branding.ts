import type { DocBranding } from './doc-branding';

/**
 * Dasani Enterprises / Blue Ice identity exactly as every document has always printed it.
 *
 * Single remaining home of these strings in application code (the migration
 * 20261009000000_add_vendor_branding backfills the same values into VendorBranding). Used ONLY as a
 * safety net when the vendor is on the legacy allow-list (WHATSAPP_ALLOWED_VENDOR_IDS) and has no
 * VendorBranding row yet / the table is unreachable — so Blue Ice documents can never degrade.
 * The CI guard (tenant-hardcode-guard.spec.ts) allow-lists this file.
 */
export const LEGACY_DOC_BRANDING: DocBranding = {
  name: 'DASANI ENTERPRISES',
  payTo: 'DASANI ENTERPRISES',
  address: 'B-145 block 13 D/1 Gulshan e Iqbal, Karachi.',
  phones: 'Cell# 0316-2677954, 0345-2364698',
  email: 'info@blueice.com.pk',
  website: 'blueice.com.pk',
  taxLine: null,
  logo: 'builtin',
  icon: 'builtin',
  gradient: null,
  paymentAccounts: [
    { kind: 'BANK', accountTitle: 'DASANI ENTERPRISES', bankName: 'Meezan Bank', accountNumber: '9933-0104414597' },
    { kind: 'EASYPAISA', accountTitle: 'DASANI ENTERPRISES', accountNumber: '03162677954' },
  ],
  footerNote: null,
};
