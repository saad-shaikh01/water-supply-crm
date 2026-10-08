-- Per-vendor company profile / branding (additive only; see docs/features/multi-vendor-branding-and-whatsapp.md)
CREATE TABLE "VendorBranding" (
    "vendorId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "legalName" TEXT,
    "address" TEXT,
    "phones" TEXT,
    "email" TEXT,
    "website" TEXT,
    "ntn" TEXT,
    "strn" TEXT,
    "logoKey" TEXT,
    "iconKey" TEXT,
    "primaryColor" TEXT,
    "accentColor" TEXT,
    "paymentAccounts" JSONB NOT NULL DEFAULT '[]',
    "invoiceFooter" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorBranding_pkey" PRIMARY KEY ("vendorId")
);

ALTER TABLE "VendorBranding" ADD CONSTRAINT "VendorBranding_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: Blue Ice (Dasani Enterprises) — the EXACT strings its documents have always printed
-- (statement / receipt / salary slip / daily sheet), so its PDFs do not change. Matched by slug;
-- no row is created for any other vendor (they fill in their own profile). If this vendor's slug is
-- not 'blue-ice' on some database, the app falls back to the same values in code (legacy gate),
-- and the row can be created from the Company Profile screen.
INSERT INTO "VendorBranding" (
    "vendorId", "displayName", "legalName", "address", "phones", "email", "website",
    "logoKey", "iconKey", "paymentAccounts", "updatedAt"
)
SELECT
    v."id",
    'DASANI ENTERPRISES',
    'DASANI ENTERPRISES',
    'B-145 block 13 D/1 Gulshan e Iqbal, Karachi.',
    'Cell# 0316-2677954, 0345-2364698',
    'info@blueice.com.pk',
    'blueice.com.pk',
    'builtin:blue-ice',
    'builtin:blue-ice',
    '[{"kind":"BANK","accountTitle":"DASANI ENTERPRISES","bankName":"Meezan Bank","accountNumber":"9933-0104414597"},{"kind":"EASYPAISA","accountTitle":"DASANI ENTERPRISES","accountNumber":"03162677954"}]'::jsonb,
    CURRENT_TIMESTAMP
FROM "Vendor" v
WHERE v."slug" = 'blue-ice'
ON CONFLICT ("vendorId") DO NOTHING;
