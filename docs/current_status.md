# Project Current Status - Water Supply CRM

**Last Updated:** February 12, 2026 (Session 4)
**Status:** ✅ Backend PRODUCTION READY — 95 endpoints, 16 modules, full payment system (Raast QR + Manual), balance reminders, customer portal

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
| WhatsApp | whatsapp-web.js (optional, WHATSAPP_ENABLED=true) |
| Real-time Tracking | Server-Sent Events (SSE) + ioredis Pub/Sub |
| Payment Gateway | Paymob (Raast QR) + Manual (screenshot review) |
| File Uploads | Multer (local disk — payment screenshots) |
| Frontend | Next.js 16 + React 19 |

---

## 2. Backend — All Implemented Modules

### Auth Module (`/api/auth`)
| Method | Endpoint | Auth | Roles | Description |
| :--- | :--- | :--- | :--- | :--- |
| POST | `/auth/login` | ❌ | — | Login → access_token + refresh_token |
| GET | `/auth/me` | ✅ | Any | Current user profile |
| POST | `/auth/refresh` | ❌ | — | Exchange refresh token → new token pair (rotated) |
| POST | `/auth/logout` | ❌ | — | Invalidate refresh token (Redis delete) |
| POST | `/auth/forgot-password` | ❌ | — | Send password reset email (Gmail SMTP) |
| POST | `/auth/reset-password` | ❌ | — | Reset password + send confirmation email |

### Users Module (`/api/users`)
| Method | Endpoint | Auth | Roles | Description |
| :--- | :--- | :--- | :--- | :--- |
| POST | `/users` | ✅ | VENDOR_ADMIN | Create staff/driver user |
| GET | `/users` | ✅ | VENDOR_ADMIN, STAFF | List vendor users (cached 5min) |
| GET | `/users/:id` | ✅ | VENDOR_ADMIN, STAFF | User detail |
| PATCH | `/users/:id` | ✅ | VENDOR_ADMIN | Update user |
| PATCH | `/users/:id/deactivate` | ✅ | VENDOR_ADMIN | Soft disable (isActive=false), history kept |
| PATCH | `/users/:id/reactivate` | ✅ | VENDOR_ADMIN | Re-enable deactivated user |
| DELETE | `/users/:id` | ✅ | VENDOR_ADMIN | Hard delete (blocked if daily sheets exist) |

### Vendors Module (`/api/vendors`)
| Method | Endpoint | Auth | Roles | Description |
| :--- | :--- | :--- | :--- | :--- |
| POST | `/vendors` | ✅ | SUPER_ADMIN | Create vendor + admin user |
| GET | `/vendors` | ✅ | SUPER_ADMIN | List all vendors with customer/driver counts |
| GET | `/vendors/:id` | ✅ | SUPER_ADMIN, VENDOR_ADMIN | Vendor detail |
| GET | `/vendors/:id/stats` | ✅ | SUPER_ADMIN | Deep stats: revenue, deliveries, balance, activity |
| GET | `/vendors/:id/users` | ✅ | SUPER_ADMIN | All users under a vendor |
| PATCH | `/vendors/:id` | ✅ | SUPER_ADMIN | Update vendor info |
| PATCH | `/vendors/:id/suspend` | ✅ | SUPER_ADMIN | Suspend vendor + instantly block all users (Redis) |
| PATCH | `/vendors/:id/unsuspend` | ✅ | SUPER_ADMIN | Restore vendor access |
| POST | `/vendors/:id/reset-admin-password` | ✅ | SUPER_ADMIN | Force-reset vendor admin password |
| DELETE | `/vendors/:id` | ✅ | SUPER_ADMIN | Delete vendor + all data (blocked if transactions exist) |

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
| DELETE | `/routes/:id` | ✅ | VENDOR_ADMIN | Delete route (blocked if customers assigned) |

### Vans Module (`/api/vans`)
| Method | Endpoint | Auth | Roles | Description |
| :--- | :--- | :--- | :--- | :--- |
| POST | `/vans` | ✅ | VENDOR_ADMIN, STAFF | Register van |
| GET | `/vans` | ✅ | Any | List vans (cached 5min) |
| GET | `/vans/:id` | ✅ | Any | Van detail |
| PATCH | `/vans/:id` | ✅ | VENDOR_ADMIN, STAFF | Update van |
| DELETE | `/vans/:id` | ✅ | VENDOR_ADMIN | Delete van (blocked if open sheets) |

### Customers Module (`/api/customers`)
| Method | Endpoint | Auth | Roles | Description |
| :--- | :--- | :--- | :--- | :--- |
| POST | `/customers` | ✅ | VENDOR_ADMIN, STAFF | Create customer + init wallets |
| GET | `/customers` | ✅ | VENDOR_ADMIN, STAFF, DRIVER | Paginated list (search, routeId, sort) |
| GET | `/customers/:id` | ✅ | VENDOR_ADMIN, STAFF, DRIVER | Detail with wallets + custom prices |
| PATCH | `/customers/:id` | ✅ | VENDOR_ADMIN, STAFF | Update customer |
| DELETE | `/customers/:id` | ✅ | VENDOR_ADMIN | Delete (blocked if transactions exist) |
| POST | `/customers/:id/custom-prices` | ✅ | VENDOR_ADMIN, STAFF | Set/update custom price |
| DELETE | `/customers/:id/custom-prices/:productId` | ✅ | VENDOR_ADMIN, STAFF | Remove custom price |
| GET | `/customers/:id/transactions` | ✅ | VENDOR_ADMIN, STAFF, DRIVER | Paginated transaction history |
| POST | `/customers/:id/portal-account` | ✅ | VENDOR_ADMIN | Create login credentials for customer portal access |
| DELETE | `/customers/:id/portal-account` | ✅ | VENDOR_ADMIN | Remove customer portal account |

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
| GET | `/daily-sheets/:id/export` | ✅ | VENDOR_ADMIN, STAFF | Download PDF (A4, printable, with reconciliation) |

### Dashboard Module (`/api/dashboard`)
| Method | Endpoint | Auth | Roles | Description |
| :--- | :--- | :--- | :--- | :--- |
| GET | `/dashboard/overview` | ✅ | VENDOR_ADMIN, STAFF | KPIs: customers, products, revenue, bottles (cached 1min) |
| GET | `/dashboard/daily-stats?date=` | ✅ | VENDOR_ADMIN, STAFF | Sheets, deliveries, bottles, cash for a day |
| GET | `/dashboard/revenue?dateFrom=&dateTo=` | ✅ | VENDOR_ADMIN | Revenue time series (cached 1min) |
| GET | `/dashboard/top-customers?limit=` | ✅ | VENDOR_ADMIN, STAFF | Top customers by revenue (cached 1min) |
| GET | `/dashboard/route-performance?date=` | ✅ | VENDOR_ADMIN, STAFF | Per-route completion stats (cached 1min) |
| GET | `/dashboard/platform` | ✅ | SUPER_ADMIN | Platform KPIs: all vendors, revenue, growth % (cached 1min) |

### Customer Portal Module (`/api/portal`)
| Method | Endpoint | Auth | Roles | Description |
| :--- | :--- | :--- | :--- | :--- |
| GET | `/portal/me` | ✅ | CUSTOMER | Customer's own profile + balances |
| GET | `/portal/balance` | ✅ | CUSTOMER | Balance + effective prices (custom or base) |
| GET | `/portal/payment-info` | ✅ | CUSTOMER | Vendor's Raast ID + payment instructions |
| GET | `/portal/transactions` | ✅ | CUSTOMER | Own transaction history (paginated) |
| GET | `/portal/deliveries` | ✅ | CUSTOMER | Own delivery history (paginated) |

### Payment Module — Customer Portal (`/api/portal/payments`)
| Method | Endpoint | Auth | Roles | Description |
| :--- | :--- | :--- | :--- | :--- |
| POST | `/portal/payments/raast` | ✅ | CUSTOMER | Initiate Raast QR session (Paymob) → checkout URL |
| POST | `/portal/payments/manual` | ✅ | CUSTOMER | Submit manual payment (ref no + screenshot) |
| GET | `/portal/payments/:id` | ✅ | CUSTOMER | Check payment status |
| GET | `/portal/payments` | ✅ | CUSTOMER | My payment history (paginated) |
| GET | `/portal/payment-info` | ✅ | CUSTOMER | Vendor's Raast ID + payment instructions |

### Payment Module — Vendor Admin (`/api/payment-requests`)
| Method | Endpoint | Auth | Roles | Description |
| :--- | :--- | :--- | :--- | :--- |
| GET | `/payment-requests` | ✅ | VENDOR_ADMIN, STAFF | List all payment requests (filter: status, customerId) |
| GET | `/payment-requests/:id` | ✅ | VENDOR_ADMIN, STAFF | Detail + screenshot path |
| PATCH | `/payment-requests/:id/approve` | ✅ | VENDOR_ADMIN | Approve → auto-record in ledger + WhatsApp customer |
| PATCH | `/payment-requests/:id/reject` | ✅ | VENDOR_ADMIN | Reject with reason + WhatsApp customer |

### Webhook (no auth — Paymob calls this)
| Method | Endpoint | Auth | Description |
| :--- | :--- | :--- | :--- |
| POST | `/webhooks/paymob` | ❌ | Paymob sends payment confirmation → auto-record + WhatsApp |

### Balance Reminder Module (`/api/balance-reminders`)
| Method | Endpoint | Auth | Roles | Description |
| :--- | :--- | :--- | :--- | :--- |
| POST | `/balance-reminders/schedule` | ✅ | VENDOR_ADMIN | Configure repeatable CRON reminder (default: 9 AM PKT daily) |
| GET | `/balance-reminders/schedule` | ✅ | VENDOR_ADMIN | Check if scheduled + next run time |
| DELETE | `/balance-reminders/schedule` | ✅ | VENDOR_ADMIN | Disable automatic reminders |
| POST | `/balance-reminders/send-now` | ✅ | VENDOR_ADMIN | Immediately send reminders (supports dryRun preview) |

### Real-time Tracking Module (`/api/tracking`)
| Method | Endpoint | Auth | Roles | Description |
| :--- | :--- | :--- | :--- | :--- |
| POST | `/tracking/location` | ✅ | DRIVER, STAFF | Driver pushes GPS location (lat/lng/speed/bearing) |
| GET | `/tracking/active` | ✅ | VENDOR_ADMIN, STAFF | Snapshot of all active drivers for vendor |
| GET | `/tracking/driver/:driverId` | ✅ | VENDOR_ADMIN, STAFF | Single driver's last known location |
| GET | `/tracking/subscribe` | ✅ | VENDOR_ADMIN, STAFF | **SSE stream** — live location updates (dashboard) |

---

## 3. Cross-Cutting Features

### Redis Caching
- All list endpoints check cache before querying DB
- Cache invalidated on every create/update/delete
- Cache key pattern: `vendor:{vendorId}:{entity}`
- TTLs: Products=5min, Routes=5min, Vans=5min, Users=5min, Customers=2min, Wallets=30s, Dashboard=1min

### RBAC (Role-Based Access Control)
- `@Roles()` decorator + `RolesGuard` on all endpoints
- Permissive by default (no @Roles() = allow all authenticated)
- Hierarchy: SUPER_ADMIN > VENDOR_ADMIN > STAFF > DRIVER > CUSTOMER

### Input Validation
- `ValidationPipe` globally (whitelist + forbidNonWhitelisted + transform)
- All DTOs have `class-validator` decorators
- Returns 400 with detailed error messages on invalid input

### Rate Limiting
- Global: 10/sec, 100/min, 1000/hr
- Auth endpoints: 3/sec, 5/min, 20/hr
- Write operations: 5/sec, 20/min
- Sheet generation/close: 1/sec, 3/min

### Payment System

#### Raast QR Flow (Automated via Paymob)
```
Customer → POST /portal/payments/raast { amount }
→ Paymob creates checkout session
→ Returns { checkoutUrl, qrExpiresAt }
→ Customer opens checkoutUrl → scans QR in HBL/MCB/JazzCash/etc.
→ Paymob sends POST /webhooks/paymob (HMAC verified)
→ System auto-records payment in ledger
→ WhatsApp confirmation sent to customer
→ Status: PAID
```

#### Manual Payment Flow (screenshot + reference number)
```
Customer → GET /portal/payment-info → sees vendor's Raast ID
Customer pays via JazzCash/Easypaisa/Raast/IBFT
Customer → POST /portal/payments/manual { amount, method, referenceNo, screenshot }
→ Status: PENDING
Vendor Admin → GET /payment-requests (sees pending list + screenshot)
Vendor Admin → PATCH /payment-requests/:id/approve
→ Auto-records in ledger → WhatsApp sent to customer
→ Status: APPROVED
```

#### Payment Methods Supported
| Method | Flow | Notes |
|:--|:--|:--|
| `RAAST_QR` | Automated (Paymob) | Needs PAYMOB_* env vars configured |
| `MANUAL_RAAST` | Manual review | Customer pays to vendor's Raast ID |
| `MANUAL_JAZZCASH` | Manual review | Customer pays to vendor's JazzCash |
| `MANUAL_EASYPAISA` | Manual review | Customer pays to vendor's Easypaisa |
| `MANUAL_BANK` | Manual review | Customer does IBFT/bank transfer |

#### Paymob Setup (for Raast QR)
```env
PAYMOB_API_KEY=...               # From Paymob dashboard → Settings
PAYMOB_RAAST_INTEGRATION_ID=... # From Paymob → Payment Integrations → Raast
PAYMOB_HMAC_SECRET=...          # From Paymob → Settings → HMAC
PAYMOB_BASE_URL=https://accept.paymob.com/api
API_URL=https://yourdomain.com/api  # For webhook callback URL
```
_If Paymob keys not configured → falls back to mock QR (for development)_

### WhatsApp Notifications
- Triggered via BullMQ `NOTIFICATIONS` queue (fire-and-forget)
- Rate-limited: 1 message per phone per minute (Redis)
- Enable: set `WHATSAPP_ENABLED=true`, scan QR code on first start
- Session persisted via LocalAuth (no re-scan after restart)

### Real-time Tracking Architecture
- Driver calls `POST /tracking/location` → stored in Redis (TTL 5min, auto-clears offline drivers)
- Redis Pub/Sub fans out to ALL app instances
- Dashboard connects to `GET /tracking/subscribe` (SSE) → receives live updates
- On connect: initial snapshot sent immediately + then live stream

### Vendor Suspension (Real-time)
- `PATCH /vendors/:id/suspend` → sets `isActive=false` in DB + `vendor:{id}:suspended = true` in Redis (no TTL)
- Every JWT request checks this Redis key (< 1ms) — suspended users get **instant 401** even with valid token
- `PATCH /vendors/:id/unsuspend` → restores DB + deletes Redis key
- SUPER_ADMIN is never affected (no vendorId in their JWT)

### JWT Refresh Tokens
- Login returns `access_token` (1 day) + `refresh_token` (UUID, 7 days, stored in Redis)
- `POST /auth/refresh` — validates Redis, rotates both tokens (old refresh immediately revoked)
- `POST /auth/logout` — deletes refresh token from Redis (instant session invalidation)
- Deactivated users cannot refresh — checked at refresh time

### Email Service (Gmail SMTP)
- `POST /auth/forgot-password` → reset link sent to user's email (expires 15min)
- `POST /auth/reset-password` → password changed + confirmation email sent
- Graceful degradation: if `MAIL_*` env missing, logs link to console (dev mode)

### Health Checks
- `GET /api/health` — DB + Redis + Memory + Disk (returns 503 if any fail)
- `GET /api/health/live` — liveness probe (instant, no DB call)
- `GET /api/health/ready` — readiness probe (DB + Redis only)

### Daily Sheet PDF Export
- `GET /api/daily-sheets/:id/export` → downloads A4 PDF
- Includes: sheet info, driver/van/route, bottle & cash summary boxes, reconciliation discrepancies, full delivery table with color-coded status, totals row

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

## 5. Environment Variables — Complete List

```env
# ── Core ─────────────────────────────────────────────────────────────
DATABASE_URL=postgresql://user:pass@localhost:5432/water_crm
JWT_SECRET=your-strong-secret-key-min-32-chars
PORT=3000

# ── Redis ─────────────────────────────────────────────────────────────
REDIS_URL=redis://localhost:6379

# ── Email (Gmail SMTP) ────────────────────────────────────────────────
MAIL_HOST=smtp.gmail.com
MAIL_PORT=587
MAIL_USER=yourapp@gmail.com
MAIL_PASS=xxxx xxxx xxxx xxxx    # 16-char Gmail App Password
MAIL_FROM="Water Supply CRM <yourapp@gmail.com>"
FRONTEND_URL=http://localhost:3000

# ── WhatsApp (optional — skip if not using) ───────────────────────────
WHATSAPP_ENABLED=true
WHATSAPP_SESSION_PATH=./.whatsapp-sessions
CHROMIUM_PATH=/usr/bin/chromium    # Linux/Docker only

# ── Payment Gateway — Paymob (for Raast QR) ──────────────────────────
# Register at https://paymob.com/pk → complete business verification
PAYMOB_API_KEY=                    # Settings → API Keys
PAYMOB_RAAST_INTEGRATION_ID=       # Payment Integrations → Raast → Integration ID
PAYMOB_HMAC_SECRET=                # Settings → Security → HMAC Secret
PAYMOB_BASE_URL=https://accept.paymob.com/api
API_URL=https://yourdomain.com/api # Your public API URL (for Paymob webhook callback)
# ⚠ If Paymob keys are empty → system uses mock QR (safe for development)
```

---

## 6. What's Still Missing

| Feature | Priority | Notes |
| :--- | :--- | :--- |
| Prisma migrations | 🔴 Critical | Run `prisma generate` + `prisma migrate dev` before first deploy |
| Swagger/OpenAPI documentation | 🟠 High | `@nestjs/swagger` — frontend team needs API reference |
| Env variables validation on startup | 🟠 High | Joi schema — catch missing env at boot, not at runtime |
| Unit / integration tests | 🟡 Medium | All endpoints manually testable via Postman now |
| Notification history log | 🟡 Medium | Store sent WhatsApp messages in DB |
| Audit log | 🟡 Low | Track who approved/changed what |

---

## 7. Endpoint Count by Module

| Module | Endpoints | Base Path |
| :--- | :---: | :--- |
| Auth | 6 | `/api/auth` |
| Users | 7 | `/api/users` |
| Vendors | 10 | `/api/vendors` |
| Products | 5 | `/api/products` |
| Routes | 5 | `/api/routes` |
| Vans | 5 | `/api/vans` |
| Customers | 10 | `/api/customers` |
| Transactions | 5 | `/api/transactions` |
| Daily Sheets | 11 | `/api/daily-sheets` |
| Dashboard | 6 | `/api/dashboard` |
| Customer Portal | 5 | `/api/portal` |
| Payment (Portal) | 4 | `/api/portal/payments` |
| Payment (Admin) | 4 | `/api/payment-requests` |
| Webhook | 1 | `/api/webhooks` |
| Balance Reminders | 4 | `/api/balance-reminders` |
| Tracking | 4 | `/api/tracking` |
| Health | 3 | `/api/health` |
| **TOTAL** | **95** | |

---

## 8. Super Admin Flow — Complete Coverage

| Scenario | Endpoint | ✅ |
| :--- | :--- | :--- |
| Onboard new vendor | POST /vendors | ✅ |
| View all vendors + health | GET /vendors | ✅ |
| Drill into vendor stats | GET /vendors/:id/stats | ✅ |
| See all vendor users | GET /vendors/:id/users | ✅ |
| Suspend misbehaving vendor | PATCH /vendors/:id/suspend | ✅ |
| Restore vendor access | PATCH /vendors/:id/unsuspend | ✅ |
| Help vendor admin login | POST /vendors/:id/reset-admin-password | ✅ |
| Remove test/inactive vendor | DELETE /vendors/:id | ✅ |
| Platform KPIs & growth | GET /dashboard/platform | ✅ |

---

## 9. Customer Portal — Complete Flow

### Step 1: Vendor creates portal account for customer
```
POST /customers/:id/portal-account
Body: { email, password }
→ Creates User(role=CUSTOMER), links to customer
→ Customer can now login at POST /auth/login
```

### Step 2: Customer logs in
```
POST /auth/login { email, password }
→ Returns { access_token, refresh_token, user: { role: CUSTOMER, customerId } }
→ customerId is embedded in JWT for all portal requests
```

### Step 3: Customer views their account
```
GET /portal/me            → profile + wallets + custom prices
GET /portal/balance       → balance + effective prices per product
GET /portal/transactions  → payment & delivery history (paginated)
GET /portal/deliveries    → delivery history with driver/van info
```

### Step 4: Customer pays their outstanding balance

**Option A — Raast QR (Automated):**
```
GET /portal/payment-info          → see vendor Raast ID + instructions
POST /portal/payments/raast { amount: 2500, method: "RAAST_QR" }
→ Returns { checkoutUrl, qrExpiresAt }
→ Customer opens checkoutUrl → scans QR in banking app
→ Paymob webhook fires → balance auto-updated → WhatsApp confirmation
```

**Option B — Manual (JazzCash / Easypaisa / Bank Transfer):**
```
GET /portal/payment-info          → see vendor Raast ID (0300-XXXXXXX)
Customer pays manually outside app
POST /portal/payments/manual (multipart/form-data)
  { amount, method: MANUAL_JAZZCASH, referenceNo, screenshot (file) }
→ Status: PENDING
Vendor reviews in dashboard → GET /payment-requests
Vendor approves → PATCH /payment-requests/:id/approve
→ Balance auto-updated → WhatsApp confirmation to customer
```

---

## 10. Database — New Models Added (Session 4)

| Model | Fields | Relations |
| :--- | :--- | :--- |
| `PaymentRequest` | id, vendorId, customerId, amount, method, status, gatewayOrderId, gatewayTxId, checkoutUrl, qrCodeData, qrExpiresAt, referenceNo, screenshotPath, customerNote, reviewedBy, reviewedAt, rejectionReason | → Vendor, → Customer |

**PaymentMethod enum:** `RAAST_QR`, `MANUAL_RAAST`, `MANUAL_JAZZCASH`, `MANUAL_EASYPAISA`, `MANUAL_BANK`

**PaymentRequestStatus enum:** `PENDING`, `PROCESSING`, `PAID`, `APPROVED`, `REJECTED`, `EXPIRED`, `CANCELLED`

**Vendor model** now has `raastId String?` — set via `PATCH /vendors/:id { raastId: "0300-XXXXXXX" }`

**Uploaded files:** stored at `uploads/payment-screenshots/<filename>`, served at `GET /uploads/payment-screenshots/<filename>`
