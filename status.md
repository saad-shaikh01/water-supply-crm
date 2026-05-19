Water Supply CRM — Complete Code Review Report
Date: 2026-05-20 | Scope: API Backend + Vendor Dashboard | Agents Used: 3 specialized reviewers

────────────────────────────────────────────────────────────────────
CODE QUALITY FIXES — Implemented 2026-05-20 (from code_review.md)
────────────────────────────────────────────────────────────────────
✅ B1  — Prisma tx: any → Prisma.TransactionClient in customer.service.ts + ledger.service.ts
✅ B2  — AuthUser interface defined in libs/shared/types; CurrentUser decorator typed; all 25 controllers updated (user: any → user: AuthUser)
✅ B3  — PaymentType.CASH / PaymentType.MONTHLY enum used instead of string literals in buildReconciliation
✅ B4  — FCM/WhatsApp .catch(() => null) → logger.warn() in order.service.ts (4 places) and daily-sheet.service.ts (3 places)
✅ B5  — Idempotency logic extracted into private applyIdempotentRepost() in ledger.service.ts (70+ lines → 1 call)
✅ B6  — groupSum<T>() helper extracted in analytics.service.ts; used for revenueByDay, byCat, expByDay, reasonMap
✅ B7  — Prisma P2002 (unique constraint) caught in user.service.ts create() with ConflictException
✅ B8  — Month param validation already handled by @Matches(/^\d{4}-\d{2}$/) in StatementQueryDto (no change needed)
✅ F4  — useMemo added for items, loads, doneItems, stats, filteredItems, paginatedItems, totalPages in sheet-detail.tsx
✅ F5  — useCustomerSchedule queryKey: params object → spread primitives (params.dateFrom, params.dateTo)
✅ F6  — All useMutation hooks already had onError handlers (confirmed across all 18 hook files)
✅ F7  — enabled: !!id && !!params?.dateFrom guard added to useCustomerSchedule
✅ F8  — All mutation invalidations already using base ['customers'] key (confirmed, no change needed)
✅ F9  — formatTime, formatPhone, FAILURE_CATEGORIES, CATEGORY_LABELS, formatCategory moved to module level in sheet-detail.tsx

Remaining (large refactors — plan for future sprint):
⬜ F2  — Split sheet-detail.tsx (1300 lines) into SheetHeader, DeliveryQueue, LoadTripsSection, dialogs
⬜ F3  — Split customer-detail.tsx (763 lines), extract dialog components
⬜ F14 — Replace 16 useState calls with useReducer in SheetDetail
────────────────────────────────────────────────────────────────────

Executive Summary
Category	Critical	High	Medium	Low
Backend Security & Logic	2	3	4	4
Frontend / UX	0	5	8	11
Database & Performance	2	3	5	0
Missing Features	2	3	8	4
Total	6	14	25	19
1. Backend Security & Logic Issues
CRITICAL
C1 — Arbitrary File Access (IDOR) on Ticket Attachments

File: apps/api-backend/src/app/modules/ticket/ticket-portal.controller.ts
Issue: GET /portal/tickets/attachment-url?key=<any_key> returns a signed Wasabi URL for any S3 key, regardless of who uploaded it. A logged-in customer can request payment screenshots belonging to other vendors or customers.
Fix: Before generating the signed URL, verify the key belongs to a TicketMessage owned by the requesting customer:

const message = await this.prisma.ticketMessage.findFirst({
  where: { 
    attachments: { path: ['$[*].key'], string_contains: key },
    ticket: { customer: { userId } }
  }
});
if (!message) throw new ForbiddenException();
C2 — Open CORS (All Origins Allowed)

File: apps/api-backend/src/main.ts
Issue: app.enableCors() with no config allows any domain to call the API with credentials.
Fix:

app.enableCors({
  origin: process.env.ALLOWED_ORIGINS?.split(','),
  credentials: true,
});
HIGH
H1 — Notification Preferences Never Checked

Files: apps/api-backend/src/app/modules/order/order.service.ts, apps/api-backend/src/app/modules/balance-reminder/balance-reminder.service.ts
Issue: NotificationPreference model exists, API exists, but it is never consulted before queuing WhatsApp/FCM/SMS. Every notification goes to every channel regardless of user settings.
Fix: Inject NotificationPreferenceService in each service, check enabled channels before queuing.
H2 — Payment + Ledger Not Atomic

File: apps/api-backend/src/app/modules/payment/payment.service.ts
Issue: initiateRaastQr() creates a PaymentRequest record, then calls the external Paymob gateway, then updates it — three steps with no $transaction. If the update fails after the gateway call succeeds, Paymob has an orphaned order.
Fix: Wrap in this.prisma.$transaction(async tx => { ... }).
H3 — No Idempotency on Webhook Replay

File: apps/api-backend/src/app/modules/payment/payment.service.ts
Issue: Duplicate Paymob webhooks can create duplicate ledger entries, duplicate WhatsApp messages, and double-counted balances. Only checks if status is already PAID, but doesn't guard against concurrent delivery.
Fix: Cache idempotency key in Redis: webhook:paymob:<gatewayOrderId> with 1-hour TTL.
MEDIUM
M1 — Deactivated User Can Still Access Portal

File: apps/api-backend/src/app/modules/customer-portal/customer-portal.service.ts
Issue: JWT guard validates the token but doesn't check user.isActive. A deactivated customer's token still works until expiry.
M2 — Password Min Length Inconsistent (6 vs 8 chars)

Files: customer-portal/dto/change-password.dto.ts (6 chars) vs auth/dto/reset-password.dto.ts (8 chars)
Fix: Standardize to 8 chars minimum across all DTOs.
M3 — SMS Channel is a Stub — Not Implemented

File: apps/api-backend/src/app/modules/notifications/notification.processor.ts
Issue: SEND_SMS job handler only prints to console. No SMS provider (Twilio/AWS SNS) wired up. Balance reminders and order notifications silently skip SMS customers.
M4 — Balance Reminder Cooldown Flag Exists But Does Nothing

File: apps/api-backend/src/app/modules/balance-reminder/balance-reminder.service.ts
Issue: force field in ScheduleReminderDto is accepted but never read. Vendors can spam customers repeatedly.
2. Frontend / UX Issues (Vendor Dashboard)
HIGH — Data Sync
H4 — Stale Data After Mutations (Query Key Mismatch)

File: apps/vendor-dashboard/src/lib/query-keys.ts
Issue: invalidateQueries({ queryKey: queryKeys.products.all() }) generates ['products', {}]. Actual cached keys include page/limit params like ['products', { page: 1, limit: 20 }] — these don't match. Lists show old data after create/update.
Fix: Invalidate using the base key without params: invalidateQueries({ queryKey: ['products'] }) (React Query v5 matches all sub-keys).
H5 — useAllCustomers Cache Not Invalidated After Customer Create

File: apps/vendor-dashboard/src/features/customers/hooks/use-customers.ts
Issue: useAllCustomers builds key [...queryKeys.customers.all({}), 'all']. Customer create/update mutations only invalidate ['customers'], missing the 'all' variant. Customer dropdowns in forms show stale data.
H6 — Sheet Generation Silent Failure

File: apps/vendor-dashboard/src/features/daily-sheets/components/sheet-generate.tsx
Issue: Polling for generation status doesn't handle status === 'failed'. Modal stays open on "Processing..." forever if the backend job fails. Users don't know what happened.
Fix: Add error state when status is failed:

if (status?.status === 'failed') return <SheetGenerationError onRetry={retryGenerate} />;
H7 — No Retry on Failed Payment Mutations

File: apps/vendor-dashboard/src/features/transactions/hooks/use-transactions.ts
Issue: Payment recording failures only show a toast. For a financial operation, the user must close the form and reopen just to retry — no retry button, no confirmation the amount was/wasn't recorded.
MEDIUM — UX & Validation
M5 — Custom Price Dialog Doesn't Reset on Reopen

File: apps/vendor-dashboard/src/features/customers/components/customer-detail.tsx
Issue: Opening "Add Custom Rate" dialog twice shows values from the previous attempt. User may accidentally save a duplicate.
M6 — Portal Email Error Not Shown in Dialog

File: apps/vendor-dashboard/src/features/customers/components/customer-detail.tsx
Issue: "Enable Portal Access" dialog sends any email to the API. Duplicate email error from API is shown as a vague toast, not inline in the dialog field.
M7 — Delivery Edit Has No Confirmation Dialog

File: apps/vendor-dashboard/src/features/daily-sheets/components/sheet-detail.tsx
Issue: One click saves delivery status as COMPLETED permanently. No "Are you sure?" step. Driver accidentally marks as delivered → admin must manually undo.
M8 — Date Range Inputs Not Validated (dateFrom > dateTo Allowed)

File: apps/vendor-dashboard/src/features/customers/components/customer-detail.tsx
Issue: Customer schedule tab date inputs have no min/max constraint. Invalid ranges return empty data with no error message.
M9 — PDF Export Has No Loading State

File: apps/vendor-dashboard/src/features/daily-sheets/components/sheet-detail.tsx
Issue: Statement/PDF download buttons have no loading spinner. Users click multiple times, creating multiple download requests.
M10 — Dispatch Filtering Missing "Urgent" Views

File: apps/vendor-dashboard/src/features/orders/api/orders.api.ts
Issue: No quick filter for "approved but not planned", "planned but targetDate past". Vendors miss overdue orders.
M11 — useCustomerSchedule Object Reference in Query Key Causes Infinite Refetch

File: apps/vendor-dashboard/src/features/customers/hooks/use-customers.ts
Issue: queryKey: ['customers', id, 'schedule', params] — params is a new object on every render, causing continuous cache misses and API calls.
Fix: queryKey: ['customers', id, 'schedule', params.dateFrom, params.dateTo]
M12 — Google Maps URL Parsing Too Limited

File: apps/vendor-dashboard/src/features/customers/components/customer-form.tsx
Issue: Only handles @lat,lng and ?q=lat,lng URL formats. Most share-link formats (e.g., /maps/place/...) are missed. Users think auto-parse is broken.
LOW — Complexity & Code Quality
L1 — SheetDetail is 600+ Lines with 10+ Dialog States

File: apps/vendor-dashboard/src/features/daily-sheets/components/sheet-detail.tsx
Recommendation: Split into SheetDetailHeader, DeliveryItemsList, LoadTripsSection.
L2 — Delivery Schedule Grid Too Dense on Mobile

File: apps/vendor-dashboard/src/features/customers/components/customer-form.tsx
Issue: 6 day toggles + van dropdown + sequence input in tight grid. Mobile users struggle.
L3 — Hardcoded Refetch Intervals

File: apps/vendor-dashboard/src/features/driver/components/driver-home.tsx
staleTime: 30_000 hardcoded across multiple components. Should be centralized in queryClient defaults.
3. Database & Performance Issues
CRITICAL
C3 — N+1 Query in getDriverStats()

File: apps/api-backend/src/app/modules/daily-sheet/daily-sheet.service.ts
Issue: Loads all sheets + all items for a driver, then processes 1,200+ records in application-level loops instead of DB aggregation. Gets exponentially worse with more history.
Fix:

const stats = await this.prisma.dailySheetItem.groupBy({
  by: ['status'],
  where: { dailySheet: { driverId, vendorId, date: { gte: start } } },
  _count: { id: true },
  _sum: { filledDropped: true, cashAmount: true },
});
C4 — Cache Invalidation Gaps After Key Mutations

File: libs/shared/caching/src/lib/cache-invalidation.service.ts
Issue: The following operations do NOT invalidate relevant cache keys:
Operation	Missing Invalidation
submitDelivery()	dashboard:analytics:*, dashboard:daily:*
closeSheet()	All analytics caches
approvePayment()	dashboard:overview, customer balance
checkIn() / loadOut()	Daily sheet state cache
approveOrder()	On-demand queue count
Fix: Add invalidateFinancialDashboard(), invalidateDailyDashboard(), invalidateDeliveryMetrics() methods and call them after each mutation.
HIGH
H8 — 10+ Missing Database Indexes

File: libs/shared/database/prisma/schema.prisma
Add these missing indexes:


model Product {
  @@index([vendorId])          // MISSING — every product list query scans all products
}
model DailySheetItem {
  @@index([productId])         // MISSING — reconciliation joins
}
model Transaction {
  @@index([vendorId, type, createdAt])  // MISSING — analytics aggregations
}
model PaymentRequest {
  @@index([vendorId, status, createdAt])  // MISSING — dashboard pending list
}
model CustomerOrder {
  @@index([vendorId, status, dispatchStatus])  // MISSING — dispatch queue
}
model DeliveryIssue {
  @@index([dailySheetItemId])  // MISSING — issue lookup from sheet
}
model DailySheetLoad {
  @@index([dailySheetId, tripNumber])  // MISSING — load checkin queries
}
model DailySheet {
  @@index([vendorId, driverId, date])  // MISSING — driver portal queries
}
H9 — findAll() on Daily Sheets Has No Pagination

File: apps/api-backend/src/app/modules/daily-sheet/daily-sheet.service.ts
Issue: findAll() loads all sheets for a vendor with full relations. 5 years of operation = 1,825+ sheets all loaded at once.
Fix: Add skip/take pagination parameters.
MEDIUM
M13 — Overly Broad Relation Include in findOne() (Sheet Detail)

File: apps/api-backend/src/app/modules/daily-sheet/daily-sheet.service.ts
Issue: A sheet with 100 delivery items loads all 100 customers with their wallets, products, all in a single monster query. Separate into smaller targeted queries by need.
M14 — Ledger Idempotency Has Race Condition

File: apps/api-backend/src/app/modules/transaction/ledger.service.ts
Issue: recordDelivery() does deleteMany() then create() for idempotency. Two concurrent calls both see no existing record → both create → duplicate ledger entries. Use upsert instead.
M15 — Soft-Delete Pattern Inconsistent Across Models

File: libs/shared/database/prisma/schema.prisma
Issue: User, Customer, Product, Van have isActive. But CustomerOrder, CustomerTicket, DeliveryIssue, Expense, PaymentRequest have only status enums. Analytics queries must manually exclude cancelled/rejected records in every query (easy to forget).
4. Missing Features & Automation
HIGH Priority
#	Feature	Current State	Gap	Suggested Fix
F1	SMS Notifications	Queue defined, processor is a stub	No SMS provider wired	Integrate Twilio or AWS SNS in notification.processor.ts
F2	Auto Order Dispatch	3-4 manual steps per order	No auto-assign to van/route	Add background job to assign approved orders based on CustomerDeliverySchedule
F3	Vendor Notification Center	FCM only (transient)	No persistent notification feed for vendor staff	Extend InAppNotification for vendor roles + build notification bell in vendor-dashboard
MEDIUM Priority
#	Feature	Current State	Gap	File Path
F4	Dispatch Notifications to Customers	Approve/reject sends FCM	No notification when order is planned or dispatched	order.service.ts
F5	Balance Reminder Cooldown	force flag in DTO	Flag is never read — spam risk	balance-reminder.service.ts
F6	Payment Request Reminders	No automation	Pending payment requests go unnoticed after N days	New scheduled job in PaymentModule
F7	Portal Notification Persistence	Client-side aggregate from orders/tickets	Notifications lost on browser close	Wire to InAppNotification model via /portal/notifications
F8	Cron Preset UI for Reminders	Raw cron string input	Vendors need to know cron syntax	Add presets: Daily 9am / Weekly Monday / Monthly 1st
F9	Notification Preference UI	API exists	Not surfaced in portal or vendor dashboard	Add settings panel to customer-portal
F10	Auto-Failure Rescheduling	Delivery issues tracked	No auto-retry or customer notification on failure	Add processor to check failed items and queue retry
F11	Bulk Order Approve + Plan	One-by-one only	Vendors with 20+ orders/day spend too much time on dispatch	Add bulk approve + bulk plan endpoints + UI
F12	Statement PDF Error Tracking	Silent failure	Vendor doesn't know PDF gen failed	Log to NotificationLog, surface in dashboard
LOW Priority
#	Feature	Gap
F13	Recurring Order Subscriptions	Customers manually re-order; no "repeat every N days"
F14	Driver ETA Notifications	Driver approaches customer → no automated "arriving soon" alert
F15	Bulk WhatsApp Broadcast	whatsapp.sendBulk() exists internally but no API/UI endpoint
F16	Bulk Customer Operations	No select-all / bulk deactivate / bulk export on any list
5. Priority Action Plan
Week 1 — Fix Now (Critical / Security)
[ ] [C1] Fix IDOR on ticket attachment URL — verify file ownership before signing
[ ] [C2] Restrict CORS to allowed origins via env var
[ ] [C3] Replace getDriverStats() loop with DB groupBy aggregation
[ ] [C4] Add cache invalidation after submitDelivery, closeSheet, approvePayment
[ ] [H2] Wrap Raast QR initiation in $transaction
✅ [H4] Fix query key invalidation pattern — use base key array without params
Week 2 — High Impact Fixes
[ ] [H8] Run Prisma migration to add 8 missing indexes (5-min schema change, big perf win)
[ ] [H1] Enforce NotificationPreference before queuing any notification
[ ] [F1] Implement SMS provider (Twilio) — unblocks full notification stack
[ ] [H6] Add error/failure state to sheet generation polling UI
[ ] [H9] Paginate findAll() in daily sheets service
Week 3 — UX Improvements
[ ] [M7] Add confirmation dialog before saving delivery status
[ ] [F2] Auto-dispatch job: assign approved orders to next scheduled van
[ ] [M4 / F5] Implement reminder cooldown using Redis TTL per customer
✅ [M11] Fix useCustomerSchedule query key (spread params, not object reference)
[ ] [F3] Vendor notification center (persistent in-app feed)
Month 2 — Feature Completions
[ ] [F4] Dispatch notifications to customers (order planned/dispatched)
[ ] [F6] Payment request reminder job (auto-reminder after 3 days pending)
[ ] [F8 / F9] Cron preset UI + notification preference settings panel
[ ] [F11] Bulk approve + bulk plan orders UI
[ ] [L1] Refactor SheetDetail (600+ lines) into sub-components
Overall Assessment: Core architecture is solid — multi-tenancy, auth, queue system, and delivery tracking are well-structured. The main risk areas are cache invalidation gaps causing stale dashboards, missing database indexes causing slow queries at scale, the IDOR vulnerability on file access, and several incomplete automation flows (SMS, notification preferences, auto-dispatch) that are partially built but not wired end-to-end. With the Week 1 fixes in place, the system is production-safe. Week 2-3 fixes will handle scale and UX polish.