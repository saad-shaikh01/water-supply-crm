Backend Completion Plan - Water Supply CRM

NOTE: This file is an old planning artifact and no longer reflects current system size.
Use `docs/STATUS.md` and `docs/EXECUTION_PLAN.md` for active execution.
Reviewed for archive on February 25, 2026.
                                                                                                                                                                        
 Context

 The Water Supply CRM backend has core modules scaffolded with basic Create/List endpoints, but is missing: complete auth flows, RBAC enforcement, full CRUD operations,
 pagination, transaction query endpoints, daily sheet lifecycle (load-out/check-in/reconciliation), and dashboard statistics. The goal is to complete all backend
 functionality to support the vendor dashboard frontend phases 1-2 and beyond.

 Current state: 9 working endpoints across 8 modules. Most modules only have POST + GET. Empty files: roles.decorator.ts, roles.guard.ts, user.controller.ts,
 transaction.controller.ts, create-user.dto.ts. No input validation (class-validator not installed).

 Target state: 46 endpoints with full CRUD, RBAC, pagination, validation, and business logic.

 ---
 Phase 0: Foundation - Validation & Pagination

 Install dependencies:
 npm install class-validator class-transformer

 Modify apps/api-backend/src/main.ts:
 - Add ValidationPipe globally with whitelist, forbidNonWhitelisted, transform, and enableImplicitConversion
 - Add app.enableCors() for frontend dev

 Create pagination utility:
 - apps/api-backend/src/app/common/dto/pagination-query.dto.ts - reusable DTO with page and limit
 - apps/api-backend/src/app/common/helpers/paginate.ts - helper returning { data, meta: { total, page, limit, totalPages } }

 Add class-validator decorators to all 8 existing DTOs:
 - login.dto.ts - @IsEmail(), @IsString()
 - create-vendor.dto.ts - @IsString(), @IsEmail(), @IsOptional()
 - create-product.dto.ts - @IsString(), @IsNumber(), @Min(0)
 - create-customer.dto.ts - @IsString(), @IsArray(), @IsInt(), @IsOptional(), @IsUUID()
 - create-route.dto.ts - @IsString()
 - create-van.dto.ts - @IsString(), @IsOptional(), @IsUUID()
 - generate-sheets.dto.ts - @IsDateString()
 - submit-delivery.dto.ts - @IsEnum(), @IsInt(), @IsNumber(), @Min(0)

 ---
 Phase 1: Auth Completion & Roles Guard

 Implement RBAC (both files currently empty):
 - apps/api-backend/src/app/common/decorators/roles.decorator.ts - @Roles() decorator using SetMetadata
 - apps/api-backend/src/app/common/guards/roles.guard.ts - RolesGuard using Reflector to check user role. Permissive by default (no @Roles() = allow all authenticated)

 Complete Auth module:
 - Modify auth.controller.ts - add 3 endpoints:
   - GET /auth/me - returns current user profile (requires JWT)
   - POST /auth/forgot-password - generates JWT reset token (15min expiry), logs it
   - POST /auth/reset-password - verifies reset token, updates password
 - Modify auth.service.ts - add generateResetToken(), verifyResetToken(), resetPassword(), getProfile()
 - Create auth/dto/forgot-password.dto.ts and auth/dto/reset-password.dto.ts

 Complete User module (controller + DTOs currently empty):
 - Implement user/dto/create-user.dto.ts with validation
 - Create user/dto/update-user.dto.ts
 - Modify user.service.ts - add findAllByVendor(), update(), deactivate()
 - Implement user.controller.ts:
   - POST /users - create user (VENDOR_ADMIN only)
   - GET /users - list vendor users (VENDOR_ADMIN, STAFF)
   - GET /users/:id - user detail (VENDOR_ADMIN, STAFF)
   - PATCH /users/:id - update user (VENDOR_ADMIN)
 - Modify user.module.ts - add UserController

 ---
 Phase 2: Secure Existing + Complete CRUD (Product, Route, Van, Vendor)

 Vendor module:
 - Add @UseGuards(JwtAuthGuard, RolesGuard) to vendor.controller.ts
 - Add @Roles(SUPER_ADMIN) on create/list, @Roles(SUPER_ADMIN, VENDOR_ADMIN) on findOne
 - Add PATCH /vendors/:id endpoint (SUPER_ADMIN)
 - Create vendor/dto/update-vendor.dto.ts
 - Add update() to vendor.service.ts

 Product module:
 - Create product/dto/update-product.dto.ts
 - Add update() and toggleActive() to product.service.ts (both invalidate cache)
 - Add to product.controller.ts: PATCH /products/:id, PATCH /products/:id/toggle-active
 - Add RolesGuard + role decorators

 Route module:
 - Create route/dto/update-route.dto.ts
 - Add findOne(), update(), remove() to route.service.ts (cache invalidation)
 - Add to route.controller.ts: GET /routes/:id, PATCH /routes/:id, DELETE /routes/:id
 - Delete guarded: throw ConflictException if route has customers

 Van module:
 - Create van/dto/update-van.dto.ts
 - Add findOne(), update(), remove() to van.service.ts
 - Add to van.controller.ts: GET /vans/:id, PATCH /vans/:id, DELETE /vans/:id
 - Delete guarded: throw ConflictException if van has open daily sheets

 ---
 Phase 3: Customer Module - Full CRUD + Pagination + Custom Pricing

 New DTOs:
 - customer/dto/update-customer.dto.ts
 - customer/dto/customer-query.dto.ts - extends PaginationQueryDto with search, routeId, sort
 - customer/dto/set-custom-price.dto.ts

 Modify customer.service.ts:
 - findAllPaginated(vendorId, query) - paginated with search (name/code/phone), route filter, sort
 - findOne(vendorId, id) - customer with wallets, custom prices, recent transactions
 - update(vendorId, id, dto) - update customer, ensure vendor ownership
 - remove(vendorId, id) - only if no transactions (preserve audit trail)
 - setCustomPrice(vendorId, customerId, dto) - upsert CustomerProductPrice
 - removeCustomPrice(vendorId, customerId, productId) - delete custom price
 - getTransactionHistory(vendorId, customerId, pagination) - paginated

 Modify customer.controller.ts - 7 endpoints:
 - GET /customers - paginated list with search/filter, cached per vendor (VENDOR_ADMIN, STAFF, DRIVER)
 - GET /customers/:id - detail with wallets + prices (VENDOR_ADMIN, STAFF, DRIVER)
 - PATCH /customers/:id - update, invalidate customer cache (VENDOR_ADMIN, STAFF)
 - DELETE /customers/:id - remove, invalidate customer cache (VENDOR_ADMIN)
 - POST /customers/:id/custom-prices - set custom price, invalidate cache (VENDOR_ADMIN, STAFF)
 - DELETE /customers/:id/custom-prices/:productId - remove price, invalidate cache (VENDOR_ADMIN, STAFF)
 - GET /customers/:id/transactions - transaction history, not cached (VENDOR_ADMIN, STAFF, DRIVER)

 ---
 Phase 4: Transaction Module - Queries, Payments, Adjustments

 New DTOs:
 - transaction/dto/record-payment.dto.ts - customerId, amount, description
 - transaction/dto/record-adjustment.dto.ts - customerId, productId?, amount?, bottleCount?, description
 - transaction/dto/transaction-query.dto.ts - extends PaginationQueryDto with customerId, type, dateFrom, dateTo

 Modify ledger.service.ts (keep existing recordDelivery):
 - recordPayment(vendorId, dto) - create PAYMENT transaction, decrement customer financialBalance
 - recordAdjustment(vendorId, dto) - create ADJUSTMENT transaction, adjust financialBalance and/or BottleWallet
 - findAllPaginated(vendorId, query) - paginated with filters
 - findByCustomer(vendorId, customerId, pagination) - customer transactions
 - getCustomerLedgerSummary(vendorId, customerId) - balance + wallets + recent transactions

 Implement transaction.controller.ts (currently empty):
 - GET /transactions - paginated filtered list (VENDOR_ADMIN, STAFF)
 - POST /transactions/payments - record payment, invalidate customer cache + wallet cache, trigger WhatsApp notification via NotificationService.queueWhatsApp()
 (VENDOR_ADMIN, STAFF)
 - POST /transactions/adjustments - record adjustment, invalidate caches (VENDOR_ADMIN)
 - GET /transactions/customers/:customerId - customer transactions (VENDOR_ADMIN, STAFF, DRIVER)
 - GET /transactions/customers/:customerId/summary - ledger summary (VENDOR_ADMIN, STAFF, DRIVER)

 Modify transaction.module.ts - add TransactionController

 ---
 Phase 5: Daily Sheet Lifecycle - Load-Out, Check-In, Reconciliation

 New DTOs:
 - daily-sheet/dto/load-out.dto.ts - filledOutCount
 - daily-sheet/dto/check-in.dto.ts - filledInCount, emptyInCount, cashCollected
 - daily-sheet/dto/daily-sheet-query.dto.ts - extends PaginationQueryDto with date, dateFrom, dateTo, routeId, driverId, isClosed
 - daily-sheet/dto/swap-driver.dto.ts - driverId, vanId?

 Modify daily-sheet.service.ts:
 - findAllPaginated(vendorId, query) - replace existing findAll with paginated + filtered version
 - loadOut(vendorId, sheetId, dto) - set filledOutCount, create LOAD_OUT transaction
 - checkIn(vendorId, sheetId, dto) - set filledInCount/emptyInCount/cashCollected, create CHECK_IN transaction
 - closeSheet(vendorId, sheetId) - validate all items non-PENDING, calculate reconciliation, set isClosed=true, return discrepancy report
 - swapDriver(vendorId, sheetId, dto) - swap driverId/vanId on open sheet
 - getSheetsByDriver(vendorId, driverId, date?) - driver's sheets

 Modify daily-sheet.controller.ts - add endpoints:
 - GET /daily-sheets - update to paginated + filtered
 - GET /daily-sheets/driver/:driverId - driver's sheets (MUST be before :id route)
 - PATCH /daily-sheets/:id/load-out - record load-out (VENDOR_ADMIN, STAFF)
 - PATCH /daily-sheets/:id/check-in - record check-in (VENDOR_ADMIN, STAFF)
 - POST /daily-sheets/:id/close - close/reconcile (VENDOR_ADMIN, STAFF)
 - PATCH /daily-sheets/:id/swap-driver - swap driver (VENDOR_ADMIN)

 Important: Route ordering in controller - /driver/:driverId and /generation-status/:jobId must be defined BEFORE /:id.

 ---
 Phase 6: Dashboard Statistics Module (New)

 Create new module:
 - apps/api-backend/src/app/modules/dashboard/dashboard.module.ts
 - apps/api-backend/src/app/modules/dashboard/dashboard.service.ts
 - apps/api-backend/src/app/modules/dashboard/dashboard.controller.ts
 - apps/api-backend/src/app/modules/dashboard/dto/dashboard-query.dto.ts

 Endpoints (all cached with 60s TTL via Redis):
 - GET /dashboard/overview - totalCustomers, totalProducts, totalRoutes, totalVans, totalDrivers, totalOutstandingBalance, totalBottlesOut (VENDOR_ADMIN, STAFF)
 - GET /dashboard/daily-stats?date= - sheets, deliveries, bottles, cash for a day (VENDOR_ADMIN, STAFF)
 - GET /dashboard/revenue?dateFrom=&dateTo= - revenue time series (VENDOR_ADMIN)
 - GET /dashboard/top-customers?limit= - top customers by revenue (VENDOR_ADMIN, STAFF)
 - GET /dashboard/route-performance?date= - per-route stats (VENDOR_ADMIN, STAFF)

 Modify app.module.ts - add DashboardModule import

 ---
 Cross-Cutting: Redis Caching, Rate Limiting & BullMQ Usage in All New Code

 Every new and modified endpoint must properly leverage the existing infrastructure:

 Redis Caching (via CacheInvalidationService)

 - All list/findAll endpoints must check cache first, return cached data if available
 - All create/update/delete operations must invalidate the relevant cache
 - Cache keys follow the pattern: vendor:{vendorId}:{entity} (use cache.vendorKey())
 - TTLs: use CACHE_TTLS constants (products=5min, routes=5min, add new constants for customers=2min, users=5min, dashboard=1min)
 - New cache keys to add to libs/shared/caching/src/lib/cache-keys.constants.ts: CUSTOMERS, USERS, VANS, DASHBOARD
 - Customer transactions should NOT be cached (real-time accuracy needed)
 - Dashboard stats can be cached with short TTL (60s)

 Rate Limiting (via @Throttle decorator)

 - All write endpoints (POST/PATCH/DELETE) should have tighter rate limits than default
 - Auth endpoints: strict limits (already done for login, apply same to forgot-password/reset-password)
 - Bulk operations (daily-sheet generate, close): very strict (1/sec, 3/min)
 - Standard CRUD writes: use medium throttle override
 - Read endpoints: use global defaults (10/sec, 100/min, 1000/hr)

 BullMQ Queues

 - Keep daily sheet generation async (already done)
 - Notification triggers: when delivery is completed (submitDelivery), when payment is recorded, call NotificationService.queueWhatsApp() to send receipt
 - Reconciliation report generation could be async for large vendors (optional, start synchronous)

 ---
 File Summary

 23 new files | 34 modified files | 46 total endpoints

 Key files to reuse:

 - libs/shared/database/ - PrismaService (already global)
 - libs/shared/caching/src/lib/cache-invalidation.service.ts - CacheInvalidationService with vendorKey(), invalidateVendorEntity(), get(), set()
 - libs/shared/caching/src/lib/cache-keys.constants.ts - CACHE_KEYS, CACHE_TTLS
 - libs/shared/queue/src/lib/queue-names.constants.ts - QUEUE_NAMES
 - apps/api-backend/src/app/common/decorators/current-user.decorator.ts - @CurrentUser()
 - apps/api-backend/src/app/common/guards/jwt-auth.guard.ts - JwtAuthGuard

 ---
 Verification Plan

 After each phase, test via curl or Postman:

 1. Phase 0: Send malformed POST to /api/products -> should get 400 with validation errors
 2. Phase 1: POST /api/auth/login -> get token -> GET /api/auth/me -> see profile. Create a STAFF user -> try POST /api/users as STAFF -> get 403
 3. Phase 2: Try PATCH /api/products/:id to update price, DELETE /api/routes/:id with customers -> get 409
 4. Phase 3: GET /api/customers?search=john&routeId=xxx&page=1&limit=10 -> paginated results
 5. Phase 4: POST /api/transactions/payments -> check customer balance decreased
 6. Phase 5: Full lifecycle: generate -> load-out -> deliver items -> check-in -> close -> verify reconciliation totals
 7. Phase 6: GET /api/dashboard/overview -> see aggregated stats

 End-to-end: Run npx nx serve api-backend with Docker services running (docker-compose up -d).
