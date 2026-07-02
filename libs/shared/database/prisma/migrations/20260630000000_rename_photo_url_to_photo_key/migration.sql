-- Rename photoUrl to photoKey on DailySheetItem: it stores a private Wasabi object key, not a public URL.
ALTER TABLE "DailySheetItem" RENAME COLUMN "photoUrl" TO "photoKey";
