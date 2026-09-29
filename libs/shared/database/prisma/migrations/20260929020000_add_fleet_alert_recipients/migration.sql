-- Fleet Alert Recipients (owner-requested 2026-09-29): a vendor-wide list of
-- WhatsApp numbers (e.g. owner/manager) that the existing nightly Fleet
-- notification sweep (document expiry + maintenance due/overdue) also alerts
-- on WhatsApp, in addition to the in-app/FCM alert already sent to
-- VENDOR_ADMIN/STAFF logins. Deliberately not tied to an existing User row —
-- the intended recipient often has no login.
--
-- Purely additive: one new table. No existing table altered, no data backfill.

-- CreateTable
CREATE TABLE "FleetAlertRecipient" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FleetAlertRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FleetAlertRecipient_vendorId_isActive_idx" ON "FleetAlertRecipient"("vendorId", "isActive");

-- AddForeignKey
ALTER TABLE "FleetAlertRecipient" ADD CONSTRAINT "FleetAlertRecipient_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FleetAlertRecipient" ADD CONSTRAINT "FleetAlertRecipient_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
