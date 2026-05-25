# Performance & Caching Improvement Plan

> Project: water-supply-crm | Date: 2026-05-22
> Stack: NestJS + Prisma + PostgreSQL + Redis | Next.js 16 + React Query + TanStack

---

## Current State Summary

| Area | Status | Notes |
|------|--------|-------|
| Redis caching | ✅ Done | `SharedCachingModule` with `cache-manager-redis-yet` |
| Cache keys & TTLs | ✅ Done | `CACHE_KEYS` + `CACHE_TTLS` constants defined |
| Cache invalidation | ✅ Done | `CacheInvalidationService` with vendor-scoped keys |
| Rate limiting | ✅ Done | Redis-backed throttler (10/s, 100/min, 1000/hr) |
| DB indexes | ✅ Done | 35+ composite indexes on schema |
| Pagination | ✅ Done | page/limit on customer & transaction queries |
| Selective Prisma queries | ✅ Done | Dashboard uses `select` to limit fields |
| React Query staleTime | ⚠️ Partial | `staleTime: 60s` set — too short, no `gcTime` |
| HTTP compression | ❌ Missing | No `compression` middleware in `main.ts` |
| Redis SCAN vs KEYS | ⚠️ Bug risk | `delByPattern` uses `KEYS` — blocks Redis in prod |
| Cache-Control headers | ❌ Missing | No HTTP cache headers on API responses |
| Service-level caching | ⚠️ Partial | Only dashboard/analytics cached — products/routes/vans/users not cached |
| Next.js image optimization | ❌ Missing | No `next/image` used, raw `<img>` tags |
| Bundle analysis | ❌ Missing | No `@next/bundle-analyzer` configured |

---

## Phase 1 — Quick Wins (High Impact, Minimal Risk)

### 1.1 Add HTTP Compression to NestJS

**File:** `apps/api-backend/src/main.ts`
**Impact:** Reduces API response size by 60–80% for JSON payloads
**Effort:** 10 min

Install:
```bash
npm install compression
npm install -D @types/compression
```

Add to `main.ts` inside `bootstrap()`, before `app.listen()`:
```ts
import * as compression from 'compression';

app.use(compression());
```

---

### 1.2 Fix Redis KEYS → SCAN (Production Safety)

**File:** `libs/shared/caching/src/lib/cache-invalidation.service.ts`
**Impact:** Prevents Redis event-loop blocking on large key sets
**Effort:** 20 min

Current `delByPattern` uses `client.keys(pattern)` which is O(N) blocking.

Replace with SCAN-based iteration:
```ts
private async delByPattern(pattern: string): Promise<void> {
  try {
    const client = (this.cacheManager as any).store?.client;
    if (!client) return;

    let cursor = 0;
    const keysToDelete: string[] = [];
    do {
      const [nextCursor, keys] = await client.scan(cursor, { MATCH: pattern, COUNT: 100 });
      cursor = Number(nextCursor);
      keysToDelete.push(...keys);
    } while (cursor !== 0);

    if (keysToDelete.length) await client.del(keysToDelete);
  } catch (e) {
    this.logger.warn(`Cache pattern delete failed for "${pattern}": ${(e as Error).message}`);
  }
}
```

---

### 1.3 Tune React Query Global Defaults

**File:** `libs/shared/data-access/src/lib/query-provider.tsx`
**Impact:** Reduces unnecessary refetches, keeps data in memory longer
**Effort:** 5 min

Current config only has `staleTime: 60s`, no `gcTime`. Update to:
```ts
new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,      // 5 min — don't refetch if data is fresh
      gcTime: 10 * 60 * 1000,         // 10 min — keep in memory after component unmount
      retry: 1,
      refetchOnWindowFocus: false,     // don't refetch on every tab switch
    },
  },
})
```

> `refetchOnWindowFocus: false` is safe here — data changes only on user mutations, and those already call `invalidateQueries`.

---

### 1.4 Add Cache-Control Headers on Static List Endpoints

**Files:** `products.controller.ts`, `routes.controller.ts`, `vans.controller.ts`
**Impact:** Browser caches list responses for 5 min, cuts repeat API hits
**Effort:** 15 min per controller

Add to GET list endpoints:
```ts
import { Response } from 'express';
import { Res } from '@nestjs/common';

@Get()
async findAll(@Res({ passthrough: true }) res: Response, ...) {
  res.setHeader('Cache-Control', 'private, max-age=300'); // 5 min, authenticated only
  return this.productsService.findAll(...);
}
```

Use `private` (not `public`) — data is always vendor-scoped.

---

## Phase 2 — Medium Effort (Significant Gains)

### 2.1 Extend Service-Level Caching

**Current:** Only dashboard and analytics services cache. Products, Routes, Vans, Users lists are queried from DB on every request.

**Files to update:** `products.service.ts`, `routes.service.ts`, `vans.service.ts`, `users.service.ts`

Pattern for each `findAll`:
```ts
async findAll(vendorId: string, params: ...) {
  const cacheKey = this.cacheInvalidation.vendorKey(vendorId, CACHE_KEYS.PRODUCTS);
  const cached = await this.cacheInvalidation.get<Product[]>(cacheKey);
  if (cached) return cached;

  const data = await this.prisma.product.findMany({ where: { vendorId, ...filters } });
  await this.cacheInvalidation.set(cacheKey, data, CACHE_TTLS.PRODUCTS);
  return data;
}
```

Invalidate in `create`, `update`, `remove`:
```ts
await this.cacheInvalidation.invalidateVendorEntity(vendorId, CACHE_KEYS.PRODUCTS);
```

**TTLs to use:**
- Products: `CACHE_TTLS.PRODUCTS` (5 min)
- Routes: `CACHE_TTLS.ROUTES` (5 min)
- Vans: `CACHE_TTLS.VANS` (5 min)
- Users: `CACHE_TTLS.USERS` (5 min)

---

### 2.2 Increase staleTime Per Query Type

**Current:** All queries use 5 min global default (after Phase 1.3).
**Improvement:** Reference data like products/routes rarely changes — use longer staleTime.

In hooks like `useProducts`, `useRoutes`, `useVans`:
```ts
useQuery({
  queryKey: queryKeys.products.all(params),
  queryFn: () => fetchProducts(params),
  staleTime: 15 * 60 * 1000, // 15 min — products rarely change
})
```

For high-churn data (`useTransactions`, `useSheets`, `useDashboard`) — keep at global default (5 min).

---

### 2.3 Add Next.js Image Optimization

**Files:** All components using raw `<img>` tags for product images, avatars, logos.
**Impact:** Automatic WebP/AVIF conversion, lazy loading, prevents layout shift (CLS)

Replace:
```tsx
<img src={imageUrl} alt="product" className="w-12 h-12" />
```
With:
```tsx
import Image from 'next/image';
<Image src={imageUrl} alt="product" width={48} height={48} className="rounded" />
```

Add to `apps/vendor-dashboard/next.config.js` for Wasabi images:
```js
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 's3.wasabisys.com' },
    ],
    formats: ['image/avif', 'image/webp'],
  },
  // existing config...
};
```

---

### 2.4 Lazy Load Heavy Pages

**Files:** Analytics page, Routes/Map page (map libraries are large)
**Impact:** Reduces initial JS bundle size, faster first load

```tsx
import dynamic from 'next/dynamic';

const AnalyticsTabs = dynamic(
  () => import('../../../features/analytics/components/analytics-tabs'),
  { loading: () => <div className="animate-pulse h-96 bg-muted rounded" /> }
);
```

Apply to:
- `apps/vendor-dashboard/src/app/dashboard/analytics/page.tsx`
- Any page that imports map components (`react-map-gl`, `mapbox-gl`)

---

## Phase 3 — Advanced Optimizations

### 3.1 Audit Prisma Deep Includes

**Risk:** Deep `include` chains over-fetch data.
**File:** `apps/api-backend/src/app/daily-sheets/daily-sheet.processor.ts`

Current pattern fetches full nested objects:
```ts
include: { defaultDriver: true, routes: true, deliverySchedules: true }
```

Replace with explicit selects:
```ts
include: {
  defaultDriver: { select: { id: true, name: true } },
  routes: { select: { id: true, name: true } },
  deliverySchedules: { select: { customerId: true, dayOfWeek: true, routeSequence: true } },
}
```

Audit all service files for `include: { X: true }` patterns and replace with `select`.

---

### 3.2 Add Prisma Connection Pooling (PgBouncer)

**When:** Production with multiple NestJS replicas or high concurrent users.
**Impact:** Prevents PostgreSQL connection exhaustion.

In `schema.prisma`:
```prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")       // PgBouncer URL (transaction mode)
  directUrl = env("DIRECT_DATABASE_URL") // Direct URL for migrations only
}
```

---

### 3.3 Bundle Analysis Setup

**File:** `apps/vendor-dashboard/next.config.js`
**Impact:** Find large packages bloating the client bundle

Install:
```bash
npm install -D @next/bundle-analyzer
```

Update `next.config.js`:
```js
const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
});

module.exports = composePlugins(withBundleAnalyzer, withNx)(nextConfig);
```

Run analysis:
```bash
ANALYZE=true npx nx build vendor-dashboard
```

---

## Priority Checklist

### Phase 1 (Do First — All Safe, Non-Breaking)
- [ ] **1.1** `npm install compression` → add `app.use(compression())` in `main.ts`
- [ ] **1.2** Replace `client.keys()` with SCAN loop in `cache-invalidation.service.ts`
- [ ] **1.3** Update `query-provider.tsx` → staleTime 5min + gcTime 10min + no windowFocus refetch
- [ ] **1.4** Add `Cache-Control: private, max-age=300` to products/routes/vans controllers

### Phase 2 (Next Sprint)
- [ ] **2.1** Cache `findAll` in products, routes, vans, users services
- [ ] **2.2** Override staleTime to 15 min in static-data hooks
- [ ] **2.3** Replace `<img>` with `next/image` + add Wasabi remote patterns
- [ ] **2.4** Add `dynamic()` imports on analytics and map pages

### Phase 3 (When Scaling)
- [ ] **3.1** Audit and fix deep Prisma `include: { X: true }` patterns
- [ ] **3.2** Configure PgBouncer for connection pooling
- [ ] **3.3** Set up bundle analyzer, identify and tree-shake heavy deps

---

## Estimated Impact After Phase 1

| Metric | Before | After Phase 1 |
|--------|--------|---------------|
| API response size | ~100KB avg | ~20KB avg (gzip) |
| Unnecessary refetches | Every 1 min | Every 5 min |
| Redis KEYS blocking | Possible in prod | Eliminated |
| Browser caching | None | 5 min for reference data |
