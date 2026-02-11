The backend API (NestJS/Prisma/PostgreSQL) has solid business logic but zero performance infrastructure. No rate limiting, caching, queuing,
 structured logging, or database indexes exist. Docker containers for Redis and RabbitMQ are already running but unused. This plan adds 5
 performance pillars to make the system production-ready for high load.

 Implementation Order

 Pillar 4 (DB Indexes)  ─┐
                          ├─> Pillar 1 (Rate Limiting) ─┐
 Pillar 5 (Logging)     ─┘                              ├─> Pillar 2 (Async Queues)
                          ┌─> Pillar 3 (Caching)       ─┘
 Pillars 4 & 5 have no dependencies (parallel). Pillars 1 & 3 need Redis. Pillar 2 is last (depends on all others).

 ---
 Packages to Install

 # Production (10 packages)
 npm install nestjs-pino pino-http pino @nestjs/throttler @nestjs/throttler-storage-redis @nestjs/cache-manager cache-manager
 cache-manager-redis-yet @nestjs/bullmq bullmq

 # Dev (1 package)
 npm install --save-dev pino-pretty

 ---
 Pillar 4: Database Indexes (First)

 Why first: Zero code changes, immediate query speedup for all subsequent work.

 Modify: libs/shared/database/prisma/schema.prisma

 Add @@index to these models:
 ┌────────────────┬────────────────────────────────────────────────────────────────┬──────────────────────────────────────────────┐
 │     Model      │                            Indexes                             │                Query Pattern                 │
 ├────────────────┼────────────────────────────────────────────────────────────────┼──────────────────────────────────────────────┤
 │ Transaction    │ [vendorId, createdAt], [customerId, createdAt], [dailySheetId] │ Ledger history, reporting                    │
 ├────────────────┼────────────────────────────────────────────────────────────────┼──────────────────────────────────────────────┤
 │ DailySheet     │ [vendorId, date], [vendorId, routeId, date], [driverId, date]  │ Sheet listing, duplicate check in generate() │
 ├────────────────┼────────────────────────────────────────────────────────────────┼──────────────────────────────────────────────┤
 │ DailySheetItem │ [dailySheetId, sequence], [dailySheetId, customerId]           │ Ordered item listing                         │
 ├────────────────┼────────────────────────────────────────────────────────────────┼──────────────────────────────────────────────┤
 │ Customer       │ [vendorId], [vendorId, routeId], [routeId]                     │ Customer lists, route filtering              │
 ├────────────────┼────────────────────────────────────────────────────────────────┼──────────────────────────────────────────────┤
 │ Product        │ [vendorId, isActive]                                           │ Active products query                        │
 ├────────────────┼────────────────────────────────────────────────────────────────┼──────────────────────────────────────────────┤
 │ User           │ [vendorId]                                                     │ Vendor's users                               │
 ├────────────────┼────────────────────────────────────────────────────────────────┼──────────────────────────────────────────────┤
 │ Route          │ [vendorId]                                                     │ Vendor's routes                              │
 └────────────────┴────────────────────────────────────────────────────────────────┴──────────────────────────────────────────────┘
 Then run: npx prisma migrate dev --name add-performance-indexes --schema=libs/shared/database/prisma/schema.prisma

 ---
 Pillar 5: Structured Logging with Pino (Second)

 New Nx lib: libs/shared/logging/ (@water-supply-crm/logging)

 New files:
 - libs/shared/logging/src/lib/logging.module.ts - SharedLoggingModule wrapping nestjs-pino LoggerModule with:
   - Pino-pretty transport in dev, raw JSON in production
   - Correlation ID generation via x-correlation-id header
   - Request serializer that strips auth headers
   - Redaction of password fields
 - libs/shared/logging/src/index.ts - Exports

 New file: apps/api-backend/src/app/common/interceptors/vendor-context.interceptor.ts
 - Injects vendorId, userId, userRole from JWT into Pino log context per request

 Modify:
 - tsconfig.base.json - Add @water-supply-crm/logging path alias
 - apps/api-backend/src/main.ts - Add { bufferLogs: true } to NestFactory, replace logger with app.get(Logger) from nestjs-pino
 - apps/api-backend/src/app/app.module.ts - Import SharedLoggingModule

 ---
 Pillar 1: Rate Limiting (Third)

 New Nx lib: libs/shared/rate-limiting/ (@water-supply-crm/rate-limiting)

 New files:
 - libs/shared/rate-limiting/src/lib/rate-limiting.module.ts - RateLimitingModule with:
   - 3 throttler tiers: short (10/sec), medium (100/min), long (1000/hr)
   - Redis-backed storage via @nestjs/throttler-storage-redis
   - Registers ThrottlerGuard as global APP_GUARD
 - libs/shared/rate-limiting/src/index.ts - Exports

 New file: apps/api-backend/src/app/common/guards/vendor-throttle.guard.ts
 - Extends ThrottlerGuard to track by vendorId (authenticated) or IP (unauthenticated)

 Modify:
 - tsconfig.base.json - Add @water-supply-crm/rate-limiting path alias
 - apps/api-backend/src/app/app.module.ts - Import RateLimitingModule
 - apps/api-backend/src/app/modules/auth/auth.controller.ts - Add @Throttle on login (3/sec, 5/min, 20/hr)
 - apps/api-backend/src/app/modules/daily-sheet/daily-sheet.controller.ts - Add @Throttle on generate (1/sec, 3/min)

 ---
 Pillar 3: Caching Layer (Fourth)

 New Nx lib: libs/shared/caching/ (@water-supply-crm/caching)

 New files:
 - libs/shared/caching/src/lib/caching.module.ts - SharedCachingModule (@Global) with cache-manager-redis-yet store, 60s default TTL
 - libs/shared/caching/src/lib/cache-invalidation.service.ts - Helper service with:
   - vendorKey(vendorId, entity) - Builds tenant-scoped cache keys
   - invalidateVendorEntity() - Deletes vendor entity cache
   - invalidateCustomerWallets() - Purges wallet cache after delivery
 - libs/shared/caching/src/lib/cache-keys.constants.ts - Constants for cache keys and TTLs (products: 5min, routes: 5min, customers: 2min,
 wallets: 30s)
 - libs/shared/caching/src/index.ts - Exports

 Modify:
 - tsconfig.base.json - Add @water-supply-crm/caching path alias
 - apps/api-backend/src/app/app.module.ts - Import SharedCachingModule
 - apps/api-backend/src/app/modules/product/product.service.ts - Cache findAll(), invalidate on create()
 - apps/api-backend/src/app/modules/route/route.service.ts - Cache findAll(), invalidate on create()
 - apps/api-backend/src/app/modules/transaction/ledger.service.ts - Invalidate customer wallet cache after recordDelivery()

 ---
 Pillar 2: Async Processing with BullMQ (Last)

 New Nx lib: libs/shared/queue/ (@water-supply-crm/queue)

 New files:
 - libs/shared/queue/src/lib/queue.module.ts - SharedQueueModule (@Global) with BullMQ root config (Redis URL, retry: 3 attempts with
 exponential backoff)
 - libs/shared/queue/src/lib/queue-names.constants.ts - Queue names: daily-sheet-generation, notifications
 - libs/shared/queue/src/lib/queue-events.constants.ts - Job names: generate-sheets, send-whatsapp, send-sms
 - libs/shared/queue/src/index.ts - Exports

 New file: apps/api-backend/src/app/modules/daily-sheet/daily-sheet.processor.ts
 - BullMQ @Processor that contains the actual sheet generation logic (moved from generate() in service)
 - Reports job progress, logs with Pino, returns sheet IDs created

 New module: apps/api-backend/src/app/modules/notifications/
 - notifications.module.ts - Registers notifications queue
 - notification.service.ts - queueWhatsApp(), queueSMS() methods for future use
 - notification.processor.ts - Stub processor (logs, ready for WhatsApp/SMS API integration)

 Modify:
 - tsconfig.base.json - Add @water-supply-crm/queue path alias
 - apps/api-backend/src/app/app.module.ts - Import SharedQueueModule + NotificationsModule
 - apps/api-backend/src/app/modules/daily-sheet/daily-sheet.module.ts - Register BullMQ queue, add DailySheetProcessor provider
 - apps/api-backend/src/app/modules/daily-sheet/daily-sheet.service.ts - Refactor generate() to enqueue job (returns { jobId, status: 'queued'
  } instead of blocking). Add getGenerationStatus(jobId) method.
 - apps/api-backend/src/app/modules/daily-sheet/daily-sheet.controller.ts - Add GET generation-status/:jobId endpoint

 Breaking change: POST /daily-sheets/generate changes from synchronous (returns sheets) to async (returns jobId). Clients must poll GET
 /daily-sheets/generation-status/:jobId for results.

 ---
 File Summary
 ┌───────────────────┬────────────────────────────────────────────────────────────────────┐
 │      Action       │                               Count                                │
 ├───────────────────┼────────────────────────────────────────────────────────────────────┤
 │ New Nx libs       │ 4 (logging, rate-limiting, caching, queue)                         │
 ├───────────────────┼────────────────────────────────────────────────────────────────────┤
 │ New backend files │ ~10 (processors, services, interceptors, guards)                   │
 ├───────────────────┼────────────────────────────────────────────────────────────────────┤
 │ Modified files    │ ~12 (schema, tsconfig, main.ts, app.module, services, controllers) │
 ├───────────────────┼────────────────────────────────────────────────────────────────────┤
 │ New packages      │ 11                                                                 │
 └───────────────────┴────────────────────────────────────────────────────────────────────┘
 ---
 Verification Plan

 1. Indexes: Run prisma migrate dev, verify via pgAdmin that indexes exist
 2. Logging: Start API, hit endpoints, verify structured JSON logs with correlation IDs and vendor context
 3. Rate Limiting: Rapid-fire GET /api (>10/sec) and verify 429 response; check Redis keys for throttle state
 4. Caching: Call GET /api/products twice, verify 2nd is instant; create product, verify cache invalidation
 5. Queues: Call POST /daily-sheets/generate, verify immediate { jobId } response; poll status endpoint until completed; verify sheets in DB