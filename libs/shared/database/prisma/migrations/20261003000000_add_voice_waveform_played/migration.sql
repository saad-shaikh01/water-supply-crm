-- Voice message player upgrade (owner-requested 2026-10-03).
-- audioWaveform: normalized 0-100 peak bars so the inbox can draw a real
--   waveform. NULL on every pre-existing row; the UI falls back to a
--   deterministic placeholder shape, so old messages keep working untouched.
-- playedAt / playedById: first listener other than the sender ("played" tick).
--
-- PURELY ADDITIVE: three nullable columns, no defaults, no backfill, no
-- index changes. Existing rows and queries are unaffected.

-- AlterTable
ALTER TABLE "ConversationMessage" ADD COLUMN     "audioWaveform" JSONB,
ADD COLUMN     "playedAt" TIMESTAMP(3),
ADD COLUMN     "playedById" TEXT;
