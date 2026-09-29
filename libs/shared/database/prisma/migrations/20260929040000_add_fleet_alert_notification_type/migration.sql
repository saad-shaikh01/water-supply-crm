-- Fleet Alerts (owner-requested 2026-09-29): lets a vendor turn off the
-- WhatsApp and/or FCM-push side of the Fleet nightly sweep (document expiry /
-- maintenance due-overdue) from the existing Notification Controls page,
-- same mechanism as every other flow's master switch. The in-app bell
-- notification itself is never gated by this — same as every other internal
-- ops alert.
ALTER TYPE "NotificationType" ADD VALUE 'FLEET_ALERT';
