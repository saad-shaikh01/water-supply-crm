-- Add whatsappSentAt to DailySheetItem to track delivery-complete WhatsApp notification status
ALTER TABLE "DailySheetItem" ADD COLUMN "whatsappSentAt" TIMESTAMP(3);
