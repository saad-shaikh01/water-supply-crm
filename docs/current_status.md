# Project Current Status - Water Supply CRM

**Last Updated:** February 12, 2026
**Status:** ✅ Backend COMPLETE — All 46 endpoints implemented, RBAC enforced, full lifecycle coverage

---

## 1. Technical Stack Used

| Layer | Technology |
| :--- | :--- |
| Monorepo | Nx |
| Backend | NestJS (Node.js) |
| Database ORM | Prisma |
| Database | PostgreSQL (Docker) |
| Authentication | JWT (Passport.js) + bcrypt |
| RBAC | Custom RolesGuard + @Roles() decorator |
| Input Validation | class-validator + class-transformer |
| Rate Limiting | @nestjs/throttler + Redis storage |
| Caching | cache-manager + Redis (cache-manager-redis-yet) |
| Async Queues | BullMQ + Redis |
| Structured Logging | nestjs-pino (Pino) |
| Frontend | Next.js 16 + React 19 |

---

## 2. Backend — All Implemented Modules

### Auth Module (`/api/auth`)
| Method | Endpoint | Auth | Roles | Description |
| :--- | :--- | :--- | :--- | :--- |
| POST | `/auth/login` | ❌ | — | Login, returns JWT |
| GET | `/auth/me` | ✅ | Any | Current user profile |
| POST | `/auth/forgot-password` | ❌ | — | Generate reset token (logs it) |
| POST | `/auth/reset-password` | ❌ | — | Reset password with token |

### Users Module (`/api/users`)
| Method | Endpoint | Auth | Roles | Description |
| :--- | :--- | :--- | :--- | :--- |
| POST | `/users` | ✅ | VENDOR_ADMIN | Create staff/driver user |
| GET | `/users` | ✅ | VENDOR_ADMIN, STAFF | List vendor users (cached) |
| GET | `/users/:id` | ✅ | VENDOR_ADMIN, STAFF | User detail |
| PATCH | `/users/:id` | ✅ | VENDOR_ADMIN | Update user |

### Vendors Module (`/api/vendors`)
| Method | Endpoint | Auth | Roles | Description |
| :--- | :--- | :--- | :--- | :--- |
| POST | `/vendors` | ✅ | SUPER_ADMIN | Create vendor + admin user |
| GET | `/vendors` | ✅ | SUPER_ADMIN | List all vendors |
| GET | `/vendors/:id` | ✅ | SUPER_ADMIN, VENDOR_ADMIN | Vendor detail |
| PATCH | `/vendors/:id` | ✅ | SUPER_ADMIN | Update vendor |

### Products Module (`/api/products`)
| Method | Endpoint | Auth | Roles | Description |
| :--- | :--- | :--- | :--- | :--- |
| POST | `/products` | ✅ | VENDOR_ADMIN, STAFF | Create product |
| GET | `/products` | ✅ | Any | List active products (cached 5min) |
| GET | `/products/:id` | ✅ | Any | Product detail |
| PATCH | `/products/:id` | ✅ | VENDOR_ADMIN, STAFF | Update product |
| PATCH | `/products/:id/toggle-active` | ✅ | VENDOR_ADMIN | Enable/disable product |

### Routes Module (`/api/routes`)
| Method | Endpoint | Auth | Roles | Description |
| :--- | :--- | :--- | :--- | :--- |
| POST | `/routes` | ✅ | VENDOR_ADMIN, STAFF | Create route |
| GET | `/routes` | ✅ | Any | List routes with customer count (cached 5min) |
| GET | `/routes/:id` | ✅ | Any | Route detail with customers |
| PATCH | `/routes/:id` | ✅ | VENDOR_ADMIN, STAFF | Update route |
| DELETE | `/routes/:id` | ✅ | VENDOR_ADMIN | Delete route (guarded: no customers) |

### Vans Module (`/api/vans`)
| Method | Endpoint | Auth | Roles | Description |
| :--- | :--- | :--- | :--- | :--- |
| POST | `/vans` | ✅ | VENDOR_ADMIN, STAFF | Register van |
| GET | `/vans` | ✅ | Any | List vans with drivers (cached 5min) |
| GET | `/vans/:id` | ✅ | Any | Van detail |
| PATCH | `/vans/:id` | ✅ | VENDOR_ADMIN, STAFF | Update van |
| DELETE | `/vans/:id` | ✅ | VENDOR_ADMIN | Delete van (guarded: no open sheets) |

### Customers Module (`/api/customers`)
| Method | Endpoint | Auth | Roles | Description |
| :--- | :--- | :--- | :--- | :--- |
| POST | `/customers` | ✅ | VENDOR_ADMIN, STAFF | Create customer + init wallets |
| GET | `/customers` | ✅ | VENDOR_ADMIN, STAFF, DRIVER | Paginated list (search, routeId, sort) |
| GET | `/customers/:id` | ✅ | VENDOR_ADMIN, STAFF, DRIVER | Detail with wallets + custom prices |
| PATCH | `/customers/:id` | ✅ | VENDOR_ADMIN, STAFF | Update customer |
| DELETE | `/customers/:id` | ✅ | VENDOR_ADMIN | Delete (guarded: no transactions) |
| POST | `/customers/:id/custom-prices` | ✅ | VENDOR_ADMIN, STAFF | Set/update custom price |
| DELETE | `/customers/:id/custom-prices/:productId` | ✅ | VENDOR_ADMIN, STAFF | Remove custom price |
| GET | `/customers/:id/transactions` | ✅ | VENDOR_ADMIN, STAFF, DRIVER | Paginated transaction history |

### Transactions Module (`/api/transactions`)
| Method | Endpoint | Auth | Roles | Description |
| :--- | :--- | :--- | :--- | :--- |
| GET | `/transactions` | ✅ | VENDOR_ADMIN, STAFF | Paginated list (filter by type, date, customer) |
| POST | `/transactions/payments` | ✅ | VENDOR_ADMIN, STAFF | Record payment + WhatsApp notification |
| POST | `/transactions/adjustments` | ✅ | VENDOR_ADMIN | Record manual adjustment |
| GET | `/transactions/customers/:customerId` | ✅ | VENDOR_ADMIN, STAFF, DRIVER | Customer transactions |
| GET | `/transactions/customers/:customerId/summary` | ✅ | VENDOR_ADMIN, STAFF, DRIVER | Ledger summary |

### Daily Sheets Module (`/api/daily-sheets`)
| Method | Endpoint | Auth | Roles | Description |
| :--- | :--- | :--- | :--- | :--- |
| POST | `/daily-sheets/generate` | ✅ | VENDOR_ADMIN, STAFF | Async sheet generation (returns jobId) |
| GET | `/daily-sheets/generation-status/:jobId` | ✅ | VENDOR_ADMIN, STAFF | Poll job status |
| GET | `/daily-sheets/driver/:driverId` | ✅ | VENDOR_ADMIN, STAFF, DRIVER | Driver's sheets |
| PATCH | `/daily-sheets/items/:id` | ✅ | VENDOR_ADMIN, STAFF, DRIVER | Submit delivery item |
| GET | `/daily-sheets` | ✅ | Any | Paginated list (date, route, driver, isClosed) |
| GET | `/daily-sheets/:id` | ✅ | Any | Full sheet with items |
| PATCH | `/daily-sheets/:id/load-out` | ✅ | VENDOR_ADMIN, STAFF | Record filled bottles dispatched |
| PATCH | `/daily-sheets/:id/check-in` | ✅ | VENDOR_ADMIN, STAFF | Record return (filled + empty + cash) |
| POST | `/daily-sheets/:id/close` | ✅ | VENDOR_ADMIN, STAFF | Close sheet + reconciliation report |
| PATCH | `/daily-sheets/:id/swap-driver` | ✅ | VENDOR_ADMIN | Swap driver/van on open sheet |

### Dashboard Module (`/api/dashboard`)
| Method | Endpoint | Auth | Roles | Description |
| :--- | :--- | :--- | :--- | :--- |
| GET | `/dashboard/overview` | ✅ | VENDOR_ADMIN, STAFF | Totals: customers, products, routes, vans, drivers, balance, bottles (cached 1min) |
| GET | `/dashboard/daily-stats?date=` | ✅ | VENDOR_ADMIN, STAFF | Sheets, deliveries, bottles, cash for a day (cached 1min) |
| GET | `/dashboard/revenue?dateFrom=&dateTo=` | ✅ | VENDOR_ADMIN | Revenue time series (cached 1min) |
| GET | `/dashboard/top-customers?limit=` | ✅ | VENDOR_ADMIN, STAFF | Top customers by revenue (cached 1min) |
| GET | `/dashboard/route-performance?date=` | ✅ | VENDOR_ADMIN, STAFF | Per-route completion stats (cached 1min) |

---

## 3. Cross-Cutting Features

### Redis Caching
- All list endpoints check cache before querying DB
- Cache invalidated on every create/update/delete
- Cache key pattern: `vendor:{vendorId}:{entity}`
- TTLs: Products=5min, Routes=5min, Vans=5min, Users=5min, Customers=2min, Wallets=30s, Dashboard=1min

### RBAC (Role-Based Access Control)
- `@Roles()` decorator + `RolesGuard` on all endpoints
- Permissive by default (no @Roles = allow all authenticated)
- Roles: SUPER_ADMIN > VENDOR_ADMIN > STAFF > DRIVER > CUSTOMER

### Input Validation
- `ValidationPipe` globally (whitelist + forbidNonWhitelisted + transform)
- All DTOs have `class-validator` decorators
- Returns 400 with detailed error messages on invalid input

### Rate Limiting
- Global: 10/sec, 100/min, 1000/hr
- Auth endpoints: 3/sec, 5/min, 20/hr
- Write operations: 5/sec, 20/min
- Sheet generation/close: 1/sec, 3/min

---

## 4. Shared Libraries

| Alias | Path | Purpose |
| :--- | :--- | :--- |
| `@water-supply-crm/database` | `libs/shared/database/` | Prisma client (global) |
| `@water-supply-crm/logging` | `libs/shared/logging/` | Pino structured logging |
| `@water-supply-crm/rate-limiting` | `libs/shared/rate-limiting/` | Throttler + Redis |
| `@water-supply-crm/caching` | `libs/shared/caching/` | CacheManager + Redis + CacheInvalidationService |
| `@water-supply-crm/queue` | `libs/shared/queue/` | BullMQ infrastructure |
| `@water-supply-crm/types` | `libs/shared/types/` | Shared TypeScript types |
| `@water-supply-crm/data-access` | `libs/shared/data-access/` | Axios API client + React Query provider |
| `@water-supply-crm/ui` | `libs/shared/ui/` | Shared UI utilities |

---

## 5. Next Steps — Frontend & Integration

1. **Frontend Phase 1:** Auth flow, dashboard, customers, products (in progress)
2. **Frontend Phase 2:** Daily sheets lifecycle UI (load-out → deliver → check-in → close)
3. **WhatsApp/SMS Integration:** Connect notification stubs to actual provider APIs
4. **Driver Mobile App:** Lightweight PWA for drivers using `/daily-sheets/driver/:id` endpoints
5. **Monitoring:** Health checks, Prometheus metrics, alerting
