-- Customer Communication Center — Phase 1 (docs/features/customer-communication-center.md)
-- Evolves DeliveryItemNote in place into ConversationMessage and introduces
-- Conversation + ConversationRead. All renames are Postgres metadata-only
-- operations; the ONLY data-touching steps are the backfill UPDATE/INSERTs.
-- Requires Postgres 13+ (gen_random_uuid()).

-- ── 1. Renames (metadata-only; ids, data and Wasabi audio keys untouched) ────

ALTER TYPE "NoteType" RENAME TO "MessageType";

ALTER TABLE "DeliveryItemNote" RENAME TO "ConversationMessage";

ALTER INDEX "DeliveryItemNote_pkey" RENAME TO "ConversationMessage_pkey";
ALTER INDEX "DeliveryItemNote_dailySheetItemId_idx" RENAME TO "ConversationMessage_dailySheetItemId_idx";
ALTER INDEX "DeliveryItemNote_dailySheetItemId_acknowledgedAt_idx" RENAME TO "ConversationMessage_dailySheetItemId_acknowledgedAt_idx";
ALTER INDEX "DeliveryItemNote_vendorId_idx" RENAME TO "ConversationMessage_vendorId_idx";

ALTER TABLE "ConversationMessage" RENAME CONSTRAINT "DeliveryItemNote_vendorId_fkey" TO "ConversationMessage_vendorId_fkey";
ALTER TABLE "ConversationMessage" RENAME CONSTRAINT "DeliveryItemNote_dailySheetItemId_fkey" TO "ConversationMessage_dailySheetItemId_fkey";
ALTER TABLE "ConversationMessage" RENAME CONSTRAINT "DeliveryItemNote_createdById_fkey" TO "ConversationMessage_createdById_fkey";

-- ── 2. New enum ──────────────────────────────────────────────────────────────

CREATE TYPE "ConversationStatus" AS ENUM ('OPEN', 'RESOLVED', 'CLOSED');

-- ── 3. New columns on ConversationMessage ────────────────────────────────────
-- conversationId starts nullable; backfilled below, then set NOT NULL.

ALTER TABLE "ConversationMessage"
  ADD COLUMN "conversationId" TEXT,
  ADD COLUMN "requiresAck" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "attachments" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "transcription" TEXT,
  ADD COLUMN "metadata" JSONB,
  ADD COLUMN "deletedAt" TIMESTAMP(3);

-- ── 4. Conversation table ────────────────────────────────────────────────────

CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "dailySheetItemId" TEXT NOT NULL,
    "dailySheetId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "vanId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "deliveryDate" TIMESTAMP(3) NOT NULL,
    "status" "ConversationStatus" NOT NULL DEFAULT 'OPEN',
    "lastMessageAt" TIMESTAMP(3),
    "lastMessagePreview" TEXT,
    "lastMessageSenderId" TEXT,
    "lastMessageSenderRole" TEXT,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "summary" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Conversation_dailySheetItemId_key" ON "Conversation"("dailySheetItemId");
CREATE INDEX "Conversation_vendorId_lastMessageAt_idx" ON "Conversation"("vendorId", "lastMessageAt");
CREATE INDEX "Conversation_vendorId_status_lastMessageAt_idx" ON "Conversation"("vendorId", "status", "lastMessageAt");
CREATE INDEX "Conversation_driverId_lastMessageAt_idx" ON "Conversation"("driverId", "lastMessageAt");
CREATE INDEX "Conversation_customerId_idx" ON "Conversation"("customerId");
CREATE INDEX "Conversation_dailySheetId_idx" ON "Conversation"("dailySheetId");

ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_dailySheetItemId_fkey" FOREIGN KEY ("dailySheetItemId") REFERENCES "DailySheetItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_dailySheetId_fkey" FOREIGN KEY ("dailySheetId") REFERENCES "DailySheet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_vanId_fkey" FOREIGN KEY ("vanId") REFERENCES "Van"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── 5. ConversationRead table (per-user read watermarks) ─────────────────────

CREATE TABLE "ConversationRead" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConversationRead_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ConversationRead_conversationId_userId_key" ON "ConversationRead"("conversationId", "userId");
CREATE INDEX "ConversationRead_userId_idx" ON "ConversationRead"("userId");

ALTER TABLE "ConversationRead" ADD CONSTRAINT "ConversationRead_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConversationRead" ADD CONSTRAINT "ConversationRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── 6. Backfill ──────────────────────────────────────────────────────────────

-- 6a. Every pre-existing note was an implicit blocking instruction — preserve
--     the current ack-gate behavior exactly.
UPDATE "ConversationMessage" SET "requiresAck" = true;

-- 6b. One Conversation per delivery item that already has notes. Context is
--     denormalized from the item + its sheet; rollups computed from the
--     item's existing messages.
WITH latest AS (
  SELECT DISTINCT ON (m."dailySheetItemId")
    m."dailySheetItemId",
    m."createdById" AS last_sender_id,
    u."role"::text  AS last_sender_role,
    CASE WHEN m."type" = 'VOICE' THEN '🎤 Voice message'
         ELSE left(coalesce(m."text", ''), 120)
    END             AS preview
  FROM "ConversationMessage" m
  JOIN "User" u ON u."id" = m."createdById"
  ORDER BY m."dailySheetItemId", m."createdAt" DESC
),
agg AS (
  SELECT "dailySheetItemId",
         COUNT(*)::int    AS message_count,
         MIN("createdAt") AS first_at,
         MAX("createdAt") AS last_at
  FROM "ConversationMessage"
  GROUP BY "dailySheetItemId"
)
INSERT INTO "Conversation" (
  "id", "vendorId", "dailySheetItemId", "dailySheetId", "customerId", "vanId",
  "driverId", "deliveryDate", "status", "lastMessageAt", "lastMessagePreview",
  "lastMessageSenderId", "lastMessageSenderRole", "messageCount",
  "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  s."vendorId",
  agg."dailySheetItemId",
  s."id",
  i."customerId",
  s."vanId",
  s."driverId",
  s."date",
  'OPEN',
  agg.last_at,
  latest.preview,
  latest.last_sender_id,
  latest.last_sender_role,
  agg.message_count,
  agg.first_at,
  CURRENT_TIMESTAMP
FROM agg
JOIN latest ON latest."dailySheetItemId" = agg."dailySheetItemId"
JOIN "DailySheetItem" i ON i."id" = agg."dailySheetItemId"
JOIN "DailySheet" s ON s."id" = i."dailySheetId";

-- 6c. Attach every message to its conversation, then lock the column.
UPDATE "ConversationMessage" m
SET "conversationId" = c."id"
FROM "Conversation" c
WHERE c."dailySheetItemId" = m."dailySheetItemId";

ALTER TABLE "ConversationMessage" ALTER COLUMN "conversationId" SET NOT NULL;

-- ── 7. FK + new indexes on ConversationMessage ───────────────────────────────

ALTER TABLE "ConversationMessage" ADD CONSTRAINT "ConversationMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "ConversationMessage_conversationId_createdAt_idx" ON "ConversationMessage"("conversationId", "createdAt");
CREATE INDEX "ConversationMessage_itemId_requiresAck_ack_idx" ON "ConversationMessage"("dailySheetItemId", "requiresAck", "acknowledgedAt");
