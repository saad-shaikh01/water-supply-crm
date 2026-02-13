# Backend Progress Log — Water Supply CRM

**Last Updated:** February 12, 2026 (Session 4)

---

## Summary

| Metric | Value |
| :--- | :--- |
| Total Endpoints | **95** |
| Modules Completed | **16** |
| New Files Created | **~75** |
| Files Modified | **~35** |
| Test Coverage | Pending |

---

## Phase 0 — Foundation ✅ (Feb 12, 2026)

**Goal:** Validation, pagination, and DTO hardening.

### Dependencies Added
```
class-validator
class-transformer
```

### Files Created
- `apps/api-backend/src/app/common/dto/pagination-query.dto.ts`
- `apps/api-backend/src/app/common/helpers/paginate.ts`

### Files Modified
- `apps/api-backend/src/main.ts` — Added `ValidationPipe` (whitelist, transform, forbidNonWhitelisted) + `enableCors()`
- `libs/shared/caching/src/lib/cache-keys.constants.ts` — Added `USERS`, `VANS`, `DASHBOARD` cache keys and TTLs

### DTOs Updated (class-validator decorators added)
| File | Validators Added |
| :--- | :--- |
| `auth/dto/login.dto.ts` | `@IsEmail`, `@IsString` |
| `vendor/dto/create-vendor.dto.ts` | `@IsString`, `@IsEmail`, `@IsOptional` |
| `product/dto/create-product.dto.ts` | `@IsString`, `@IsNumber`, `@Min(0)` |
| `customer/dto/create-customer.dto.ts` | `@IsString`, `@IsArray`, `@IsInt`, `@IsOptional`, `@IsUUID` |
| `route/dto/create-route.dto.ts` | `@IsString` |
| `van/dto/create-van.dto.ts` | `@IsString`, `@IsOptional`, `@IsUUID` |
| `daily-sheet/dto/generate-sheets.dto.ts` | `@IsDateString` |
| `daily-sheet/dto/submit-delivery.dto.ts` | `@IsEnum`, `@IsInt`, `@IsNumber`, `@Min(0)` |

---

## Phase 1 — Auth Completion & RBAC ✅ (Feb 12, 2026)

**Goal:** Complete auth flows, implement RBAC guards, full User CRUD.

### Files Created
- `common/decorators/roles.decorator.ts` — `@Roles(...roles)` using `SetMetadata`
- `common/guards/roles.guard.ts` — `RolesGuard` using `Reflector`; permissive if no `@Roles()`
- `auth/dto/forgot-password.dto.ts`
- `auth/dto/reset-password.dto.ts`
- `user/dto/create-user.dto.ts`
- `user/dto/update-user.dto.ts`

### Files Modified
- `auth/auth.controller.ts` — Added: `GET /auth/me`, `POST /auth/forgot-password`, `POST /auth/reset-password`
- `auth/auth.service.ts` — Added: `getProfile()`, `generateResetToken()`, `verifyResetToken()`, `resetPassword()`
- `user/user.service.ts` — Added: `findAllByVendor()`, `findOneByVendor()`, `update()`, `deactivate()`, `updatePassword()`. Now uses `CacheInvalidationService`
- `user/user.controller.ts` — Implemented: `POST /users`, `GET /users`, `GET /users/:id`, `PATCH /users/:id`
- `user/user.module.ts` — Added `UserController`

### Key Design Decisions
- `RolesGuard` is permissive: no `@Roles()` decorator = allow all authenticated users (no 403)
- Reset token uses JWT with `type: 'password-reset'` claim and 15min expiry
- Password not returned in any response (stripped from User objects)

---

## Phase 2 — Full CRUD (Vendor, Product, Route, Van) ✅ (Feb 12, 2026)

**Goal:** Add RBAC, complete CRUD (update/delete), cache on all modules.

### Files Created
- `vendor/dto/update-vendor.dto.ts`
- `product/dto/update-product.dto.ts`
- `route/dto/update-route.dto.ts`
- `van/dto/update-van.dto.ts`

### Files Modified

**Vendor:**
- Controller: Added `PATCH /vendors/:id` (SUPER_ADMIN), `@UseGuards(JwtAuthGuard, RolesGuard)` on all
- Service: Added `update()`, `NotFoundException` on `findOne()`

**Product:**
- Controller: Added `PATCH /products/:id`, `PATCH /products/:id/toggle-active`, `RolesGuard`
- Service: Added `update()`, `toggleActive()` — both invalidate PRODUCTS cache

**Route:**
- Controller: Added `GET /routes/:id`, `PATCH /routes/:id`, `DELETE /routes/:id`
- Service: Added `findOne()`, `update()`, `remove()` — delete throws `ConflictException` if customers assigned

**Van:**
- Controller: Added `GET /vans/:id`, `PATCH /vans/:id`, `DELETE /vans/:id`
- Service: Added `findOne()`, `update()`, `remove()` — now uses `CacheInvalidationService`, delete throws `ConflictException` if open sheets exist

---

## Phase 3 — Customer Full CRUD + Pagination + Custom Pricing ✅ (Feb 12, 2026)

**Goal:** Paginated search, custom pricing endpoints, transaction history.

### Files Created
- `customer/dto/update-customer.dto.ts`
- `customer/dto/customer-query.dto.ts` — extends `PaginationQueryDto` with `search`, `routeId`, `sort`
- `customer/dto/set-custom-price.dto.ts`

### Files Modified
- `customer/customer.service.ts` — Complete rewrite adding:
  - `findAllPaginated()` — search by name/code/phone, filter by routeId, sortable
  - `findOne()` — includes wallets + custom prices
  - `update()`, `remove()` — with cache invalidation; remove guarded if transactions exist
  - `setCustomPrice()` — upserts `CustomerProductPrice`
  - `removeCustomPrice()`
  - `getTransactionHistory()` — paginated, real-time (not cached)
- `customer/customer.controller.ts` — 8 total endpoints with RBAC

### Key Design Decisions
- `Prisma.CustomerProductPrice.customPrice` field (not `price`) — the schema field name
- Customer delete blocked if any transactions exist (preserve audit trail)
- Transaction history not cached (real-time accuracy needed)

---

## Phase 4 — Transaction Module ✅ (Feb 12, 2026)

**Goal:** Record payments/adjustments, paginated queries, ledger summaries.

### Files Created
- `transaction/dto/record-payment.dto.ts`
- `transaction/dto/record-adjustment.dto.ts`
- `transaction/dto/transaction-query.dto.ts`

### Files Modified
- `transaction/ledger.service.ts` — Added:
  - `recordPayment()` — decrements `financialBalance`, creates PAYMENT transaction, returns customer data for notification
  - `recordAdjustment()` — adjusts balance and/or bottle wallet, creates ADJUSTMENT transaction
  - `findAllPaginated()` — filters by customerId, type, dateFrom, dateTo
  - `findByCustomer()` — paginated customer transactions
  - `getCustomerLedgerSummary()` — balance + wallets + last 10 transactions
- `transaction/transaction.controller.ts` — Implemented with 5 endpoints
- `transaction/transaction.module.ts` — Added `TransactionController`, imported `NotificationsModule`

### Key Design Decisions
- Payment recording triggers WhatsApp notification via `NotificationService.queueWhatsApp()` (fire-and-forget, doesn't fail request)
- Payment amount stored as negative in `Transaction.amount` (convention: negative = money in)

---

## Phase 5 — Daily Sheet Lifecycle ✅ (Feb 12, 2026)

**Goal:** Load-out → deliver → check-in → close/reconcile lifecycle.

### Files Created
- `daily-sheet/dto/load-out.dto.ts`
- `daily-sheet/dto/check-in.dto.ts`
- `daily-sheet/dto/daily-sheet-query.dto.ts`
- `daily-sheet/dto/swap-driver.dto.ts`

### Files Modified
- `daily-sheet/daily-sheet.service.ts` — Added:
  - `findAllPaginated()` — filters by date/dateRange, routeId, driverId, isClosed
  - `loadOut()` — sets `filledOutCount`, creates `LOAD_OUT` transaction
  - `checkIn()` — sets `filledInCount`, `emptyInCount`, `cashCollected`, creates `CHECK_IN` transaction
  - `closeSheet()` — validates no PENDING items, calculates reconciliation report (bottle + cash discrepancies), sets `isClosed=true`
  - `swapDriver()` — updates driverId/vanId on open sheet
  - `getSheetsByDriver()` — driver's sheets with optional date filter
  - Improved `submitDelivery()` vendor ownership check
- `daily-sheet/daily-sheet.controller.ts` — 10 total endpoints

### Key Design Decisions
- Static routes (`/generate`, `/generation-status/:jobId`, `/driver/:driverId`, `/items/:id`) declared **before** `/:id` to prevent route shadowing
- `closeSheet()` returns full reconciliation report with discrepancies
- Closed sheets are immutable (all lifecycle endpoints throw `ConflictException` if `isClosed=true`)

---

## Phase 6 — Dashboard Statistics Module ✅ (Feb 12, 2026)

**Goal:** New module with aggregated stats for vendor dashboard.

### Files Created
- `dashboard/dashboard.module.ts`
- `dashboard/dashboard.service.ts`
- `dashboard/dashboard.controller.ts`
- `dashboard/dto/dashboard-query.dto.ts`

### Files Modified
- `app/app.module.ts` — Added `DashboardModule` import

### Endpoints & Logic
| Endpoint | Cache Key | Logic |
| :--- | :--- | :--- |
| `GET /dashboard/overview` | `vendor:{id}:dashboard:overview` | 7 parallel Prisma aggregations |
| `GET /dashboard/daily-stats?date=` | `vendor:{id}:dashboard:daily:{date}` | Sheets + deliveries + cash for a day |
| `GET /dashboard/revenue?dateFrom=&dateTo=` | `vendor:{id}:dashboard:revenue:{from}:{to}` | DELIVERY transactions grouped by date |
| `GET /dashboard/top-customers?limit=` | `vendor:{id}:dashboard:top-customers:{limit}` | `groupBy customerId` on DELIVERY transactions |
| `GET /dashboard/route-performance?date=` | `vendor:{id}:dashboard:route-performance:{date}` | Per-sheet completion stats |

All dashboard endpoints cached with **60s TTL**.

---

---

## Phase 7 — Customer Portal ✅ (Feb 12, 2026, Session 2)

**Goal:** Read-only portal for customers to view their own data via JWT.

### Files Created
- `customer-portal/customer-portal.service.ts`
- `customer-portal/customer-portal.controller.ts`
- `customer-portal/customer-portal.module.ts`

### Files Modified
- `auth/auth.service.ts` — `login()` now includes `customerId` in JWT payload for CUSTOMER role
- `auth/jwt.strategy.ts` — validate() returns `customerId` from payload
- `app/app.module.ts` — Added `CustomerPortalModule`

### Key Design Decisions
- CUSTOMER users have no `vendorId` on User model — service looks up Customer via `userId`
- `customerId` added to JWT so portal endpoints need no extra DB lookup to find the customer
- Effective prices: returns `customPrice` if set, falls back to `Product.basePrice`
- All 4 endpoints are `@Roles(CUSTOMER)` only — staff cannot access portal endpoints

---

## Phase 8 — WhatsApp Integration ✅ (Feb 12, 2026, Session 2)

**Goal:** Real WhatsApp message sending via whatsapp-web.js with Redis rate limiting.

### Files Created
- `whatsapp/templates/message.templates.ts` — Urdu/English templates (delivery, payment, reminder, scheduled)
- `whatsapp/providers/whatsapp-provider.interface.ts` — `IWhatsAppProvider` interface + injection token
- `whatsapp/providers/whatsapp-web.provider.ts` — whatsapp-web.js with LocalAuth, Docker puppeteer args
- `whatsapp/whatsapp.service.ts` — Redis rate-limiting (1 msg/phone/min), sendMessage(), sendBulk()
- `whatsapp/whatsapp.module.ts` — `@Global()` module

### Files Modified
- `notifications/notification.processor.ts` — BullMQ processor now calls `WhatsAppService.sendMessage()` (was stub)
- `notifications/notifications.module.ts` — Imports `WhatsAppModule`
- `app/app.module.ts` — Added `WhatsAppModule`

### Key Design Decisions
- Abstract `IWhatsAppProvider` interface allows swapping to Twilio/360dialog without changing `WhatsAppService`
- `WHATSAPP_ENABLED=true` env flag — app starts normally even if `whatsapp-web.js` not installed
- Pakistan phone format: `0xxx...` → `92xxx...@c.us` automatically
- `@Global()` means any module can inject `WhatsAppService` without importing `WhatsAppModule`
- `@ts-ignore` on dynamic imports since `whatsapp-web.js` is an optional peer dependency

---

## Phase 9 — Real-time Driver Tracking ✅ (Feb 12, 2026, Session 2)

**Goal:** Production-ready, scalable GPS tracking using SSE + Redis Pub/Sub (no WebSocket packages needed).

### Files Created
- `tracking/dto/update-location.dto.ts` — lat/lng/speed/bearing/status with validation
- `tracking/tracking.service.ts` — Two ioredis clients (publisher + subscriber), Redis SCAN, RxJS Subject
- `tracking/tracking.controller.ts` — 4 endpoints including SSE stream
- `tracking/tracking.module.ts`

### Files Modified
- `auth/auth.service.ts` — Added `name` to JWT payload
- `auth/jwt.strategy.ts` — Added `name` to CurrentUser object
- `app/app.module.ts` — Added `TrackingModule`

### Key Design Decisions
- **SSE instead of WebSockets** — no new packages needed (`@nestjs/websockets`/`socket.io` not installed), works through HTTP/1.1 proxies, auto-reconnects built into browser EventSource API
- **Two separate ioredis connections** required: subscriber client CANNOT issue regular commands while subscribed
- **Redis SCAN** (cursor-based) instead of `KEYS *` — safe for large production Redis instances
- **TTL 5 minutes** on Redis driver keys — offline drivers auto-expire, no cleanup job needed
- **Redis Pub/Sub fan-out** — when running multiple app instances, all instances get the message and push to their own SSE clients
- `onModuleDestroy` cleanly quits both Redis connections and completes the Subject

### Scalability Notes
- 1 SSE connection per dashboard tab (long-lived HTTP connection)
- Redis Pub/Sub channel: `tracking:location` (shared across all instances)
- Redis key pattern: `tracking:driver:{driverId}` with 5min TTL
- Works with any number of app replicas behind a load balancer

---

---

## Phase 10 — JWT Refresh Token + Daily Sheet PDF ✅ (Feb 12, 2026, Session 3)

### JWT Refresh Token
- Login now returns `access_token` (1 day) + `refresh_token` (UUID, 7 days, Redis-stored)
- `POST /auth/refresh` — validates + rotates (old token immediately invalidated)
- `POST /auth/logout` — deletes refresh token from Redis
- Deactivated users blocked at refresh time

### Daily Sheet PDF Export
- `GET /daily-sheets/:id/export` — A4 printable PDF via pdfkit
- Content: header, sheet info, 4 summary boxes, discrepancy row, delivery table with totals

### Files
- `auth/dto/refresh-token.dto.ts`
- `email/email.service.ts` + `email/email.module.ts` (Gmail SMTP, HTML templates)
- `daily-sheet/pdf/daily-sheet-pdf.service.ts`
- Updated: `auth.service.ts`, `auth.controller.ts`, `daily-sheet.controller.ts`, `daily-sheet.module.ts`
- Added `del()` method to `CacheInvalidationService`

---

## Phase 11 — Super Admin Complete Flow ✅ (Feb 12, 2026, Session 3)

**Goal:** Full SUPER_ADMIN coverage — vendor lifecycle, suspension, platform stats, oversight tools.

### New Endpoints (10)
| Endpoint | Feature |
| :--- | :--- |
| `GET /vendors/:id/stats` | Deep vendor stats — customers, revenue, deliveries, balance, last active |
| `GET /vendors/:id/users` | All users under a vendor |
| `PATCH /vendors/:id/suspend` | Suspend vendor + Redis flag blocks all users instantly |
| `PATCH /vendors/:id/unsuspend` | Restore access + clear Redis flag |
| `POST /vendors/:id/reset-admin-password` | Force-reset vendor admin password (support tool) |
| `DELETE /vendors/:id` | Delete vendor + all data (blocked if transactions exist) |
| `GET /dashboard/platform` | Platform KPIs: vendors, revenue, growth%, top vendors |

### Vendor Suspension Architecture
- `suspend()` → `prisma.vendor.update({ isActive: false })` + `cache.set('vendor:{id}:suspended', true, 0)`
- `JwtStrategy.validate()` — on every authenticated request, checks Redis for suspension key (~0.5ms)
- Suspended vendor's users get **instant 401** even with a valid unexpired JWT
- `unsuspend()` → `prisma.vendor.update({ isActive: true })` + `cache.del(key)` — access restored immediately

### Key Design Decisions
- Redis suspension key has **no TTL** (`ttl=0`) — stays until explicitly cleared by unsuspend
- SUPER_ADMIN users have no `vendorId` in JWT → bypass suspension check entirely
- Vendor delete cascades in correct Prisma order to avoid FK constraint violations
- `GET /vendors` now includes `_counts: { customers, drivers }` for quick health view

### Files Modified
- `vendor/vendor.service.ts` — complete rewrite, added 6 new methods
- `vendor/vendor.controller.ts` — complete rewrite, 10 endpoints
- `vendor/dto/reset-admin-password.dto.ts` — new
- `auth/jwt.strategy.ts` — now injects CacheInvalidationService, checks suspension
- `dashboard/dashboard.service.ts` — added `getPlatformOverview()`
- `dashboard/dashboard.controller.ts` — added `GET /platform`

---

## Phase 12 — Balance Reminder CRON + Customer Portal Accounts ✅ (Feb 12, 2026, Session 4)

**Goal:** Automated WhatsApp balance reminders via BullMQ + customer portal account management.

### Balance Reminder (New Module)

**Files Created:**
- `balance-reminder/dto/schedule-reminder.dto.ts` — `ScheduleReminderDto` + `SendNowDto`
- `balance-reminder/balance-reminder.service.ts` — BullMQ repeatable job management + WhatsApp sending
- `balance-reminder/balance-reminder.processor.ts` — BullMQ processor for `SEND_BALANCE_REMINDERS` jobs
- `balance-reminder/balance-reminder.controller.ts` — 4 API endpoints
- `balance-reminder/balance-reminder.module.ts`

**Files Modified:**
- `libs/shared/queue/src/lib/queue-names.constants.ts` — Added `BALANCE_REMINDERS` queue
- `libs/shared/queue/src/lib/queue-events.constants.ts` — Added `SEND_BALANCE_REMINDERS` job name
- `app/app.module.ts` — Added `BalanceReminderModule`

**Endpoints:**
| Endpoint | Description |
| :--- | :--- |
| `POST /balance-reminders/schedule` | Configure repeatable cron (default: `0 4 * * *` = 9 AM PKT) with `minBalance` |
| `GET /balance-reminders/schedule` | Check schedule status + next run time |
| `DELETE /balance-reminders/schedule` | Disable automatic reminders |
| `POST /balance-reminders/send-now` | Immediately send reminders (supports `dryRun=true` preview) |

**Architecture:**
- Per-vendor BullMQ repeatable job keyed `balance-reminder:{vendorId}` — independent schedules per tenant
- Queries customers with `financialBalance >= minBalance` (positive = owes money)
- Sends WhatsApp via `WhatsAppService.sendMessage()` — respects existing rate limit (1/phone/min)
- `dryRun=true` returns list without sending
- BullMQ handles retries on failure

### Customer Portal Account Management

**Files Created:**
- `customer/dto/create-portal-account.dto.ts` — email + password (min 8 chars)

**Files Modified:**
- `customer/customer.service.ts` — Added `createPortalAccount()` + `removePortalAccount()`
  - `createPortalAccount()`: creates User with `role=CUSTOMER`, links to customer via `userId`
  - `removePortalAccount()`: unlinks + deletes user account
- `customer/customer.controller.ts` — Added 2 endpoints:
  - `POST /customers/:id/portal-account` — VENDOR_ADMIN only
  - `DELETE /customers/:id/portal-account` — VENDOR_ADMIN only

### Bug Fix
- `user/user.service.ts` — `findByEmail()` now includes `customer: true` in include clause — fixes CUSTOMER role login (JWT was missing `customerId`)

---

## Phase 13 — Payment System (Raast QR + Manual) ✅ (Feb 12, 2026, Session 4)

**Goal:** Complete online payment checkout — Raast QR via Paymob (automated) + manual payment with screenshot upload + vendor approval flow.

### New DB Model
- `PaymentRequest` — full payment lifecycle (PENDING → PROCESSING/PAID/APPROVED/REJECTED/EXPIRED)
- `PaymentMethod` enum: `RAAST_QR`, `MANUAL_RAAST`, `MANUAL_JAZZCASH`, `MANUAL_EASYPAISA`, `MANUAL_BANK`
- `PaymentRequestStatus` enum: `PENDING`, `PROCESSING`, `PAID`, `APPROVED`, `REJECTED`, `EXPIRED`, `CANCELLED`
- `Vendor.raastId String?` — vendor's Raast phone/CNIC for manual payments

### Files Created
- `payment/dto/initiate-payment.dto.ts` — amount + PaymentMethod
- `payment/dto/submit-manual-payment.dto.ts` — amount, method, referenceNo, customerNote
- `payment/dto/review-payment.dto.ts` — ApprovePaymentDto + RejectPaymentDto (reason)
- `payment/dto/payment-query.dto.ts` — status, customerId filters
- `payment/providers/payment-provider.interface.ts` — `IPaymentProvider` + `RaastQrResult` + `PAYMENT_PROVIDER` token
- `payment/providers/paymob.provider.ts` — Paymob 3-step auth/order/paykey flow, HMAC-SHA512 webhook verification, graceful mock fallback
- `payment/payment.service.ts` — full business logic (initiate, submit, status, approve, reject, webhook handler)
- `payment/payment-portal.controller.ts` — customer portal endpoints (`/portal/payments/*`)
- `payment/payment-admin.controller.ts` — vendor admin endpoints (`/payment-requests/*`)
- `payment/webhook.controller.ts` — `POST /webhooks/paymob` (no JWT auth, HMAC verified)
- `payment/payment.module.ts` — wires everything, Strategy pattern for provider DI

### Files Modified
- `libs/shared/database/prisma/schema.prisma` — Added `PaymentRequest` model + back-relations, `Vendor.raastId`, enums
- `vendor/dto/update-vendor.dto.ts` — Added `raastId?: string`
- `customer-portal/customer-portal.service.ts` — Added `getVendorPaymentInfo()`
- `customer-portal/customer-portal.controller.ts` — Added `GET /portal/payment-info`
- `main.ts` — Switched to `NestExpressApplication`, added `useStaticAssets('uploads')`
- `app/app.module.ts` — Added `PaymentModule`
- `package.json` — Added `@types/multer` (devDependency)

### Key Design Decisions
- **Provider pattern** (`IPaymentProvider` interface) — swap Paymob for NayaPay/Foree with zero business logic change
- **Mock fallback** — if `PAYMOB_API_KEY` empty → returns mock QR data, development works without gateway
- **HMAC-SHA512** — Paymob webhook signature verified (concatenates 20 specific fields in exact order)
- **Auto-record on approve/paid** — calls `LedgerService.recordPayment()` atomically in both manual approve and webhook flows
- **WhatsApp on approve** — uses existing `MessageTemplates.paymentReceived()` (Urdu message)
- **WhatsApp on reject** — custom Urdu rejection message with reason
- **Screenshot stored locally** — `uploads/payment-screenshots/<timestamp-random>.ext`, served at `/uploads/...`
- **5MB file limit** — only JPG/PNG/WEBP accepted
- **Auto-expire PROCESSING QR** — checked in `getPaymentStatus()` when `qrExpiresAt < now`
- **Duplicate webhook guard** — checks for already PAID/APPROVED status before processing

### Endpoints (10 new)
| Endpoint | Auth | Notes |
| :--- | :--- | :--- |
| `POST /portal/payments/raast` | CUSTOMER | → Paymob → checkout URL |
| `POST /portal/payments/manual` | CUSTOMER | multipart/form-data + optional screenshot |
| `GET /portal/payments/:id` | CUSTOMER | status check + auto-expire |
| `GET /portal/payments` | CUSTOMER | payment history |
| `GET /portal/payment-info` | CUSTOMER | vendor Raast ID + instructions |
| `GET /payment-requests` | VENDOR_ADMIN, STAFF | paginated + filter |
| `GET /payment-requests/:id` | VENDOR_ADMIN, STAFF | detail + screenshot URL |
| `PATCH /payment-requests/:id/approve` | VENDOR_ADMIN | → ledger + WhatsApp |
| `PATCH /payment-requests/:id/reject` | VENDOR_ADMIN | + WhatsApp with reason |
| `POST /webhooks/paymob` | none | HMAC verified → auto-record |

---

## Known Issues / Future Improvements

| Issue | Priority | Notes |
| :--- | :--- | :--- |
| **Prisma generate + migrate** | 🔴 Critical | `prisma generate` + `prisma migrate dev` — PaymentRequest model not yet in DB |
| `UserRole` TS error | 🟠 High | Fixed by `prisma generate` — pre-existing, doesn't affect runtime |
| No Swagger/OpenAPI docs | 🟠 High | `@nestjs/swagger` — needed before frontend integration |
| No env var validation on startup | 🟡 Medium | Joi schema to catch missing env at boot time |
| No unit/integration tests | 🟡 Medium | All endpoints manually testable via Postman |
| No notification history log | 🟡 Low | Store sent WhatsApp messages to DB for audit |
| Audit log | 🟡 Low | Track who approved payments / changed customer data |
