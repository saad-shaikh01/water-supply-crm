## Phase 1 — Week 1 (Critical/Security) ✅ COMPLETED

- ✅ [C1] Fix IDOR on ticket attachment URL (verify file ownership before signing)
- ✅ [C2] Restrict CORS to allowed origins via ALLOWED_ORIGINS env var
- ✅ [C3] Replace getDriverStats() app-level loop with DB groupBy aggregation
- ✅ [C4] Add cache invalidation after submitDelivery, closeSheet, approvePayment, checkIn, loadOut, approveOrder
- ✅ [H2] Wrap Raast QR initiation (initiateRaastQr) in Prisma $transaction
- ✅ [H4] Fix query key invalidation pattern — use base key array (no params) across all hooks

---

## Phase 2 — Week 2 (High Impact) ✅ COMPLETED

- ✅ [H8] Add 8 missing Prisma indexes (Product, DailySheetItem, Transaction, PaymentRequest, CustomerOrder, DeliveryIssue, DailySheetLoad, DailySheet)
- ⬜ [H1] Check NotificationPreference before queuing WhatsApp/FCM/SMS in order & balance-reminder services
- ⬜ [F1] Implement SMS provider (Twilio/AWS SNS) in notification.processor.ts
- ✅ [H6] Add error/failure state to sheet generation polling UI in sheet-generate.tsx
- ✅ [H9] Paginate findAll() in daily-sheet.service.ts (add skip/take)

---

## Phase 3 — Week 3 (UX) ✅ COMPLETED

- ✅ [M7] Add confirmation dialog before saving delivery status as COMPLETED in sheet-detail.tsx
- ✅ [F2] Auto-dispatch background job — assign approved orders to next scheduled van/route
- ✅ [M4/F5] Implement balance reminder cooldown using Redis TTL per customer
- ✅ [M11] Fix useCustomerSchedule query key — spread params primitives instead of object reference
- ✅ [F3] Vendor notification center — persistent in-app notification feed for vendor staff

---

## Phase 4 — Month 2 (Features) ✅ COMPLETED

- ✅ [F4] Send dispatch notifications to customers when order is planned or dispatched
- ✅ [F6] Payment request reminder job — auto-remind vendor after 3 days pending
- ✅ [F8/F9] Cron preset UI for reminders + notification preference settings panel in portal
- ✅ [F11] Bulk approve + bulk plan orders — backend endpoints + vendor-dashboard UI
- ✅ [L1] Refactor SheetDetail (600+ lines) into SheetDetailHeader, DeliveryItemsList, LoadTripsSection sub-components
