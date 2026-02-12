# Backend Progress Log — Water Supply CRM

**Last Updated:** February 12, 2026

---

## Summary

| Metric | Value |
| :--- | :--- |
| Total Endpoints | **46** |
| Modules Completed | **11** |
| New Files Created | **~35** |
| Files Modified | **~20** |
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

## Known Issues / Future Improvements

| Issue | Priority | Notes |
| :--- | :--- | :--- |
| `tx` param implicit `any` type in customer.service.ts | Low | Minor TS warning, doesn't affect runtime |
| Forgot-password only logs token (no email sending) | Medium | Needs email provider integration |
| WhatsApp notifications are stubs | Medium | Needs WhatsApp Business API integration |
| No unit/integration tests | High | All logic manually testable via curl/Postman |
| No API documentation (Swagger) | Medium | Add `@nestjs/swagger` decorators |
