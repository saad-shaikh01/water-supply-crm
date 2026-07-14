# Customer Communication Center — Living Design Document

**Status: ARCHITECTURE LOCKED — implementation in progress**

This document is the single source of truth for the Customer Communication Center feature.
Every implementation phase MUST follow this architecture exactly. Any agent implementing a
phase must read this document first, implement only that phase, and update the
**Completed Phases** section and **Change Log** when done. Architectural changes require an
explicit revision approved by the project owner and a Change Log entry.

---

## 1. Goals

- Evolve the existing delivery-item note system (`DeliveryItemNote`) into real conversations
  between **Driver**, **Admin**, and **Staff**, anchored to a specific delivery.
- Two entry points over the **same data** (never duplicated):
  1. Embedded thread in the Daily Sheet customer card.
  2. A centralized inbox at `/dashboard/communications` (lightweight Slack/WhatsApp-style).
- Message types: **TEXT** and **VOICE** now; IMAGE / FILE / SYSTEM reserved for later.
- Per-user **unread tracking** with sidebar badge and inbox indicators.
- Conversation **status workflow** (OPEN / RESOLVED / CLOSED, with derived "waiting on").
- **Deep linking** both ways: inbox → exact expanded/highlighted delivery card on the sheet
  page, and sheet card → the same conversation in the inbox.
- Preserve the existing **driver acknowledgement gate** (delivery recording blocked while
  instruction messages are unacknowledged).
- AI-ready schema (transcription, summaries, metadata) with **zero future redesign**.
- Easy future integration seam for the Monthly Collection Policy feature.

## 2. Non-Goals

- No customer participation (no customer login, no external/WhatsApp messaging).
- No merge with `CustomerTicket` / `TicketMessage` (customer↔vendor support is a separate system).
- No WebSocket/SSE realtime layer — polling + FCM push only (SSE may be added later without
  schema or API changes).
- No per-message read receipts ("seen by") — watermark read state only.
- No AI features implemented (transcription, summaries, smart reminders, AI search) — schema
  seams only.
- No Collection Policy integration implemented — seam only (§10).
- No polymorphic/generic notes system — conversations are anchored to `DailySheetItem` only.
- No `Participant` table — participants are derived (sheet's current driver + all vendor
  ADMIN/STAFF as a shared office inbox).

## 3. Core Decisions (summary)

| Topic | Decision |
|---|---|
| `DeliveryItemNote` | **Evolved in place**: table renamed to `ConversationMessage`, enum `NoteType` → `MessageType`. No data copy, IDs preserved, Wasabi audio keys untouched. |
| Conversation parent | New `Conversation` model, **1:1 with `DailySheetItem`** (`dailySheetItemId` unique) — the invariant guaranteeing both views show the same data. |
| Context | Denormalized onto `Conversation` (customerId, dailySheetId, vanId, driverId, deliveryDate) for cheap inbox filtering. Driver auth NEVER trusts the denormalized `driverId` (§5.6). |
| Read state | `ConversationRead` per-user **watermarks** (`lastReadAt`), not per-message receipts. |
| Ack gate | Per-message `requiresAck` flag. Delivery blocked only on `requiresAck = true AND acknowledgedAt IS NULL`. All pre-existing notes backfilled `requiresAck = true`. |
| Backend | New dedicated `communication` module. Old note endpoints become deprecated adapters (removed in Phase 7). |
| Frontend | One shared `ConversationThread` component rendered in two shells (sheet card embed + inbox). New `features/communication/` directory. |
| Status | Stored: OPEN / RESOLVED / CLOSED. `waitingOn` (DRIVER/OFFICE) is **derived** from `lastMessageSenderRole`, never stored as status. |
| Realtime | react-query polling (thread 15s, inbox 30s, badge 60s) + FCM/InAppNotification via the existing notifications module. |
| Schema timing | **All schema lands in one Phase 1 migration** (including AI-ready nullable columns). Later phases add behavior only. |

---

## 4. Database Architecture (LOCKED)

All changes in **one migration in Phase 1**. Postgres table/enum renames are metadata-only.

### 4.1 `Conversation` (new)

One conversation per delivery item, created lazily (get-or-create on first open/message).

| Field | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `vendorId` | FK → Vendor | tenancy |
| `dailySheetItemId` | FK → DailySheetItem, **unique**, `onDelete: Cascade` | 1:1 anchor |
| `dailySheetId` | FK → DailySheet | denormalized |
| `customerId` | FK → Customer | denormalized |
| `vanId` | FK → Van | denormalized |
| `driverId` | FK → User | denormalized; synced on driver swap (§5.6) |
| `deliveryDate` | DateTime (date) | denormalized from sheet |
| `status` | enum `ConversationStatus` (OPEN, RESOLVED, CLOSED) default OPEN | §7 |
| `lastMessageAt` | DateTime? | inbox sort key |
| `lastMessagePreview` | String? | ~120 chars; `"🎤 Voice message"` for voice |
| `lastMessageSenderId` | String? | unread math |
| `lastMessageSenderRole` | String? | derives `waitingOn` |
| `messageCount` | Int default 0 | inbox row |
| `summary` | String? | AI-ready, unused |
| `metadata` | Json? | AI-ready, unused |
| `createdAt` / `updatedAt` | timestamps | |

Indexes: `@@unique([dailySheetItemId])`, `(vendorId, lastMessageAt)`,
`(vendorId, status, lastMessageAt)`, `(driverId, lastMessageAt)`, `(customerId)`, `(dailySheetId)`.

Rollup fields (`lastMessage*`, `messageCount`) are updated **in the same transaction** as each
message insert.

### 4.2 `ConversationMessage` (evolved from `DeliveryItemNote`)

Migration: `ALTER TABLE "DeliveryItemNote" RENAME TO "ConversationMessage"` and
`ALTER TYPE "NoteType" RENAME TO "MessageType"`, then add columns.

| Field | Status | Notes |
|---|---|---|
| `id`, `vendorId`, `createdById`, `createdAt`, `updatedAt` | kept | sender = `createdById` |
| `dailySheetItemId` | **kept permanently** | keeps the ack-block query single-table; keeps legacy includes working during migration |
| `conversationId` | **new** FK → Conversation, `onDelete: Cascade` | nullable → backfill → NOT NULL, same migration |
| `type` | kept; enum renamed `MessageType` | TEXT, VOICE (IMAGE, FILE, SYSTEM reserved — additive later) |
| `text`, `audioKey`, `audioDuration` | kept | existing Wasabi keys keep working |
| `requiresAck` | **new** Boolean default false | backfill sets `true` on ALL existing rows |
| `acknowledgedAt`, `acknowledgedById` | kept | meaningful only when `requiresAck` |
| `attachments` | **new** Json default `[]` | future `[{key, name, mime, size}]` (TicketMessage pattern) |
| `transcription` | **new** String? | AI-ready, unused |
| `metadata` | **new** Json? | AI-ready, unused |
| `deletedAt` | **new** DateTime? | soft delete, unused for now |

Indexes: keep existing three; add `(conversationId, createdAt)` and
`(dailySheetItemId, requiresAck, acknowledgedAt)`.

Prisma relation renames: `DailySheetItem.notes` → `messages` (or kept as `notes` until Phase 7 —
implementer's choice, but the sheet `findOne` include must keep working until Phase 7),
`User.createdDeliveryNotes` → `sentMessages`, `Vendor.deliveryItemNotes` → `conversationMessages`.

### 4.3 `ConversationRead` (new) — read watermarks

| Field | Type |
|---|---|
| `id` | uuid PK |
| `conversationId` | FK → Conversation, Cascade |
| `userId` | FK → User, Cascade |
| `lastReadAt` | DateTime |

`@@unique([conversationId, userId])`, index `(userId)`.

- Unread for user U: `message.createdAt > watermark.lastReadAt (or no watermark)` AND
  `message.createdById != U`.
- Global badge: `COUNT(Conversation WHERE lastMessageAt > COALESCE(myWatermark, epoch) AND
  lastMessageSenderId != me AND <role scope>)`.
- Per-conversation unread counts computed only for the visible inbox page (≤20 rows).
- Per-user (NOT per-side): two admins must not share a read cursor.

### 4.4 Backfill (same Phase 1 migration)

1. Insert one `Conversation` per distinct `dailySheetItemId` that has notes; denormalized
   context copied from item → sheet (customerId, dailySheetId, vanId, driverId, date);
   rollups (`lastMessageAt/preview/senderId/senderRole`, `messageCount`) computed from the
   item's existing notes; `status = OPEN`.
2. Set `conversationId` on every `ConversationMessage` row; then NOT NULL.
3. `requiresAck = true` on all pre-existing rows (preserves current gate behavior exactly).

### 4.5 Untouched

`CustomerTicket`/`TicketMessage`; all other free-text `note` columns (correctionNote,
dispatchNotes, expense notes, warehouse notes…); `DailySheetItem` and `DailySheet` columns.

---

## 5. Backend Architecture (LOCKED)

### 5.1 Module layout

```
apps/api-backend/src/app/modules/communication/
├── communication.module.ts        (imports Storage, Audit, Notifications/FCM)
├── conversation.controller.ts     (/conversations/*)
├── conversation.service.ts        (get-or-create, inbox queries, read state, status)
├── message.service.ts             (send text/voice, acknowledge, audio URLs)
└── dto/
```

Ownership boundary: the communication module owns `Conversation`, `ConversationMessage`,
`ConversationRead`. The DailySheet module keeps exactly two touchpoints:
1. The delivery-block count in `updateDeliveryItem`: `count(ConversationMessage WHERE
   dailySheetItemId = X AND requiresAck = true AND acknowledgedAt IS NULL)` — direct Prisma
   query, no cross-service call.
2. `swapAssignment` syncs `Conversation.driverId` for all conversations of that sheet
   (single `updateMany`).

### 5.2 Endpoints

All behind `JwtAuthGuard` + `RolesGuard`; tenancy via vendorId scoping with 404-on-mismatch
(same pattern as `resolveItemForNotes`). DRIVER requests are server-side scoped to
conversations whose **sheet's current driver** is the caller.

| Endpoint | Roles | Purpose |
|---|---|---|
| `PUT /conversations/for-item/:itemId` | ADMIN, STAFF, DRIVER | Idempotent get-or-create. THE entry seam (also for future Collection Policy). |
| `GET /conversations` | ADMIN, STAFF, DRIVER | Inbox list. Filters: `status`, `waitingOn`, `vanId`, `driverId`, `customerId`, `dateFrom/dateTo`, `unreadOnly`, `search` (customer name/code + preview). Paginated, sorted `lastMessageAt desc`. Rows include computed `unreadCount` + `waitingOn`. |
| `GET /conversations/unread-count` | all three | `{ count }` for sidebar badge |
| `GET /conversations/:id` | all three | detail + context block (customer, sheet id/date, van plate, driver, item sequence/status/product) |
| `GET /conversations/:id/messages` | all three | cursor-paginated (`before`), ~30/page |
| `POST /conversations/:id/messages` | all three | text `{text, requiresAck?}`; `requiresAck` ignored for DRIVER senders |
| `POST /conversations/:id/messages/voice` | all three | multipart `audio`; reuse EXACT existing contract: MIME whitelist (webm/ogg/mp4/mpeg/wav/m4a), 10 MB, memoryStorage, `?duration=` query param, Wasabi prefix `delivery-voice-notes` |
| `PATCH /conversations/:id/read` | all three | upsert watermark `lastReadAt = now()` |
| `PATCH /conversations/:id/status` | ADMIN, STAFF | resolve / close / reopen (§7) |
| `PATCH /messages/:id/acknowledge` | all three | unchanged semantics, idempotent |
| `GET /messages/:id/audio` | all three | `{ signedUrl }`, 900s TTL |

Static route ordering rule applies (declare static segments before `/:id` — existing NestJS
gotcha in this codebase).

Throttling: mirror the existing note endpoints' `@Throttle` configs on the equivalent new
endpoints.

### 5.3 Deprecated adapters (Phase 1, removed Phase 7)

The five existing `/daily-sheets/items/.../notes*` endpoints remain, delegating to the new
services:
- `POST items/:id/notes` and `POST items/:id/notes/voice` → get-or-create conversation +
  send message with `requiresAck = true`.
- `GET items/:id/notes`, `PATCH items/notes/:noteId/acknowledge`,
  `GET items/notes/:noteId/audio` → delegate to the new services.

This keeps an un-upgraded frontend fully working against the Phase 1 backend.

### 5.4 Notifications & realtime

- Polling only: thread 15s, inbox 30s, badge 60s (react-query `refetchInterval`).
- Phase 4: on message create → existing BullMQ notification processor → `InAppNotification`
  (`type: CONVERSATION_MESSAGE`, `entityId: conversationId`) + FCM push to the counterpart
  side (driver ⇄ office users), respecting `NotificationPreference`.

### 5.5 Audit

`AuditService.log` on status changes (`CONVERSATION_STATUS_CHANGE`) and acknowledgements
(`ACKNOWLEDGE_MESSAGE`). Message creation is self-auditing via the row.

### 5.6 Driver-swap consistency rule (LOCKED)

`swapAssignment` updates `Conversation.driverId` for the sheet's conversations. Driver
ACCESS checks always resolve against the sheet's current `driverId` — the denormalized column
is display/filter data only, never the authorization source.

### 5.7 AI-readiness hook

`MessageService.create` exposes one internal hook point `onMessageCreated(message)` — Phase 4
attaches notifications; future AI phases attach transcription/summary BullMQ jobs writing
`ConversationMessage.transcription` / `Conversation.summary`. No redesign needed.

---

## 6. Frontend Architecture (LOCKED — vendor-dashboard)

```
apps/vendor-dashboard/src/features/communication/
├── api/conversations.api.ts
├── hooks/use-conversations.ts     (useConversationForItem, useMessages (infinite),
│                                   useSendMessage, useSendVoiceMessage, useAcknowledge,
│                                   useMarkRead, useInbox, useUnreadBadge, useSetStatus)
└── components/
    ├── conversation-thread.tsx    ★ THE shared component (message list + composer);
    │                                props: {conversationId | itemId}, variant: 'embedded'|'inbox'
    ├── message-bubble.tsx         (evolved NoteRow: sender-aligned, ack badge, voice player)
    ├── message-composer.tsx       (text + mic + requiresAck "Instruction" toggle for office)
    ├── voice-message-player.tsx   (lifted from item-notes-panel VoiceNotePlayer;
    │                               FIX the setState-in-render auto-play bug during the lift)
    ├── ack-gate.tsx               (DriverNoteGate successor; keyed to requiresAck messages)
    ├── conversation-list.tsx      (inbox rows: preview, unread dot, status, context chips)
    ├── conversation-filters.tsx   (status/van/driver/date/search — nuqs URL state)
    └── conversation-header.tsx    (context block + "Open Delivery" + status control)

app/dashboard/communications/page.tsx   (split-pane inbox; mobile: list → full-screen thread)
components/shared/voice-recorder.tsx    (MOVED from features/daily-sheets — already generic)
```

- Daily Sheet integration: expanded card's notes section replaced by
  `ConversationThread variant="embedded"`, lazy-loaded on expand
  (`useConversationForItem(itemId)`). Row chip: message count + unread dot + pending-ack ⚠.
  `AddNoteDialog` retired (its semantics = composer's requiresAck toggle). `canRecord`
  predicate keys on unacknowledged `requiresAck` messages.
- Cache keys: `['conversation', id]`, `['conversation-messages', id]`, `['inbox']`,
  `['unread-badge']`. Sending a message does NOT invalidate the whole sheet; only ack state
  changes additionally invalidate `queryKeys.sheets.one(sheetId)` (affects `canRecord`).
- Sidebar: "Communications" under Operations (with unread badge); Driver group gets
  "Messages" → same page, server-scoped.
- Types: new interfaces in `libs/shared/types/src/lib/api-responses.ts`
  (`Conversation`, `ConversationMessage`, inbox row types). `DeliveryItemNote` type kept as
  alias until Phase 7.

### 6.1 Deep-link mechanics (LOCKED)

Inbox → **Open Delivery** → `/dashboard/sheets/:sheetId?item=:itemId`.

In `sheet-detail.tsx` (reducer with `SET_TAB`/`SET_PAGE`/`SET_EXPANDED`):
1. Read `item` via nuqs `useQueryState`.
2. When sheet data loads, locate the item; if absent → toast "Delivery not found on this
   sheet", stop.
3. Dispatch `SET_TAB('all')` (only tab guaranteed to contain any item), compute the item's
   page within that tab, dispatch `SET_PAGE` + `SET_EXPANDED(itemId)`.
4. Expanded row registers a ref; one-shot effect: `scrollIntoView({block:'center'})` + ~2s
   highlight ring (CSS animation), then CLEAR the query param.

Reverse: embedded thread header shows "Open in Communications" →
`/dashboard/communications?conversation=:id` (inbox preselects via nuqs).

---

## 7. Conversation Lifecycle (LOCKED)

- Stored `status`: **OPEN → RESOLVED → CLOSED** (+ reopen).
- **Derived `waitingOn`** from `lastMessageSenderRole`: office-last → `DRIVER`;
  driver-last → `OFFICE`; no messages → null. Filterable (column is stored). NEVER stored
  as a status value.

| Transition | Trigger |
|---|---|
| OPEN → RESOLVED | office user clicks Resolve (audited) |
| RESOLVED → OPEN | ANY new message (auto-reopen) |
| OPEN/RESOLVED → CLOSED | office user (optional future auto-close job — see Open Questions) |
| CLOSED → OPEN | office user only; **messaging into CLOSED = 409** |

Default inbox view shows OPEN; RESOLVED/CLOSED behind tabs.

## 8. Read-State Lifecycle (LOCKED)

Send → rollups update (same transaction) → counterpart badge counts it → they open thread →
mount/scroll-bottom fires `PATCH read` → watermark upserted → badge/dot clears for that user
only. **Reading ≠ acknowledging** — the ack button stays a separate explicit act on
instruction messages.

## 9. `requiresAck` Semantics (LOCKED, owner signed off)

- Office composer has an "Instruction — driver must acknowledge" toggle:
  **default ON while the item is PENDING, OFF otherwise.**
- Delivery gate blocks only on `requiresAck = true AND acknowledgedAt IS NULL`.
- Driver messages never require ack (`requiresAck` ignored for DRIVER senders).
- Backfill marks all pre-existing notes `requiresAck = true` (day-one behavior identical).

## 10. Collection Policy Integration Seam (design only — DO NOT IMPLEMENT)

The future policy validation screen will call `PUT /conversations/for-item/:itemId` and render
`ConversationThread variant="embedded"` (optionally pre-filling the composer). No schema,
endpoint, or component changes anticipated — the Phase 2 daily-sheet embed exercises the
identical path.

---

## 11. Implementation Phases

Each phase must compile, deploy independently, and preserve backward compatibility.
Phases are the sub-agent hand-off boundaries. Update this section + Change Log per phase.

### Completed Phases

- ✅ **Phase 0 — This document** (2026-07-14).
- ✅ **Phase 1 — Schema + backend core** (2026-07-14). Migration
  `20260714000000_add_communication_center` (renames + new tables + backfill — NOT yet
  applied anywhere; local Postgres was down; runs on next `prisma migrate deploy`; back up
  prod first via `deploy/backup-db.sh`). New `communication` module with all §5.2 endpoints;
  legacy note endpoints delegate to `MessageService` adapters; delivery gate now counts only
  `requiresAck` messages; swap-assignment syncs `Conversation.driverId`/`vanId`.
  Implementation notes:
  - `moveDeliveryItems` also re-syncs conversation context (sheet/van/driver/date) — the
    §5.6 consistency rule necessarily extends to item moves since they rehome the anchor.
  - `/messages/*` endpoints live in a small `message.controller.ts` (the §5.2 path contract
    requires a second controller; §5.1's file list showed one).
  - Voice sends accept optional `?requiresAck=true` (query param, mirroring `?duration=`) so
    voice instructions can gate deliveries like text instructions.
  - `DailySheetItem.notes` relation name kept (points at `ConversationMessage`) until Phase 7.
  - Legacy `GET items/:id/notes` adapter intentionally keeps the legacy vendor-only check
    (any driver in the vendor may read); the NEW conversation endpoints scope drivers to
    their own sheets.

### Remaining Phases
- ⬜ **Phase 2 — Shared thread + Daily Sheet integration.** `ConversationThread`, bubbles,
  composer, ack-gate; recorder moved to shared; sheet card swaps notes panel/dialog for the
  embedded thread; drivers can reply. No inbox yet.
- ⬜ **Phase 3 — Communication Center.** Inbox page, list + filters + search, conversation
  header, sidebar entries (admin/staff + driver). Status displayed read-only; no unread dots.
- ⬜ **Phase 4 — Read state + notifications.** Watermarks wired (mark-read, unread counts,
  sidebar badge, unread-only filter), polling intervals, FCM + InAppNotification on message
  create via existing processor.
- ⬜ **Phase 5 — Status workflow.** Resolve/close/reopen UI + transitions + auto-reopen +
  audit + Waiting Driver/Office tabs (derived filter).
- ⬜ **Phase 6 — Deep linking.** `?item=` handling in sheet-detail (tab/page/expand/scroll/
  highlight), Open Delivery + Open in Communications buttons, param clearing.
- ⬜ **Phase 7 — Cleanup + AI seams.** Delete adapter endpoints + dead frontend
  (AddNoteDialog, ItemNotesPanel, legacy api fns, `DeliveryItemNote` type alias); drop the
  full notes include from sheet `findOne` (replace with per-item
  `{messageCount, pendingAckCount}` summary); document `onMessageCreated` hook +
  transcription/summary job contracts.

## 12. Risks (watch during implementation)

1. Phase 1 migration is the only data-touching moment — backup first; rollback = restore.
2. `requiresAck` change means casual replies no longer block deliveries (intended, signed off).
3. Denormalization drift (driverId, rollups) — all writers in one service; rollups
   transactional with insert; auth never trusts denormalized driverId.
4. One customer = many threads over weeks (per-delivery anchoring is locked); mitigate via
   customer filter/search; future "group by customer" view is a pure query change.
5. Enum/model rename ripples through `daily-sheet.service.ts` + DTO — mechanical, bounded.
6. Orphaned Wasabi audio on cascade delete — pre-existing gap, out of scope.

## 13. Open Questions (defaults adopted; owner may override before the relevant phase)

1. ~~`requiresAck` default rule~~ — **RESOLVED**: ON while item PENDING, OFF otherwise (§9).
2. Drivers starting conversations (not just replying) — **default: YES, allowed**
  (get-or-create is role-open; the Collection Policy seam assumes it). Affects Phase 1 RBAC.
3. Auto-close job (RESOLVED + sheet closed >14 days) — **default: DEFERRED entirely**
  (not in Phase 5; revisit after launch).
4. Driver inbox surface — **default: same `/dashboard/communications` page, server-scoped**
  (no separate driver page). Affects Phase 3.

## 14. Change Log

| Date | Phase | Change |
|---|---|---|
| 2026-07-14 | Phase 0 | Document created from the approved architecture-lock plan. Open questions 2–4 recorded with adopted defaults; Q1 resolved per owner sign-off. |
| 2026-07-14 | Phase 0 | Owner approved defaults for open questions 2–4 (drivers can initiate; no auto-close; shared inbox page). Architecture frozen. |
| 2026-07-14 | Phase 1 | Backend implemented (schema, migration+backfill, communication module, adapters, requiresAck gate, denormalization syncs). Clarifications recorded under Completed Phases: move-sync extension of §5.6, second controller file for `/messages/*`, `?requiresAck` on voice sends. Migration not yet applied to any database. |
