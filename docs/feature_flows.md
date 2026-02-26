# Feature Flows — Water Supply CRM
**A-to-Z lifecycle of every major feature**

---

## Table of Contents
1. [System Roles](#1-system-roles)
2. [Daily Sheet Lifecycle](#2-daily-sheet-lifecycle) ← core flow
3. [Driver Journey (A to Z)](#3-driver-journey-a-to-z)
4. [Customer Lifecycle](#4-customer-lifecycle)
5. [Payment Flow — CASH Customer](#5-payment-flow--cash-customer)
6. [Payment Flow — MONTHLY Customer](#6-payment-flow--monthly-customer)
7. [Customer Portal Flow](#7-customer-portal-flow)
8. [Bottle Wallet System](#8-bottle-wallet-system)
9. [Balance Reminder Flow](#9-balance-reminder-flow)
10. [Expense Tracking Flow](#10-expense-tracking-flow)
11. [Analytics Flow](#11-analytics-flow)
12. [Auth & Session Flow](#12-auth--session-flow)

---

## 1. System Roles

| Role | Who | Access |
|------|-----|--------|
| `SUPER_ADMIN` | Platform owner | All vendors, platform dashboard |
| `VENDOR_ADMIN` | Water business owner | Full access to their vendor data |
| `STAFF` | Office employee | Read + limited write (no user management) |
| `DRIVER` | Delivery driver | Only their assigned daily sheet |
| _(Customer)_ | End customer | Customer Portal only (separate app) |

---

## 2. Daily Sheet Lifecycle

A **Daily Sheet** is the core operational document — one sheet **per van** per day (not per route).

```
OPEN → LOADED → CHECKED_IN → CLOSED
```

### Step-by-step

#### Step 1 — Generate Sheets
- **Who:** VENDOR_ADMIN or STAFF
- **Action:** `POST /daily-sheets/generate { date, vanIds? }`
- **What happens (backend):**
  1. BullMQ job is queued (`daily-sheet-generation` queue)
  2. For each **active van** (optionally filtered by `vanIds`) that has a `defaultDriver` and customers scheduled today → creates one `DailySheet`
  3. Skips vans with no `defaultDriver` assigned
  4. Skips vans that already have a sheet for the target date
  5. Customers are sourced from **van-level `deliverySchedules`** (not route-level) filtered by today's day-of-week
  6. RESCHEDULED items from previous sheets for the same customers are carried forward and deduplicated
  7. The van's first route (ordered by `createdAt asc`) is attached as `routeId` for analytics if configured
  8. Sheet starts in `OPEN` status (no `isClosed`, no load trips)
- **Frontend:** Polls `GET /daily-sheets/generation-status/:jobId` to show progress bar

> **Important:** Generation is **van-centric**, not route-centric. A route's `defaultVan` is used for form hints and analytics labels but the scheduler iterates vans directly.

#### Step 2 — Load Out (Driver loads the van)
- **Who:** DRIVER (or STAFF)
- **Action:** `PATCH /daily-sheets/:id/load-out { filledLoaded, emptyReceived }`
- **What happens:**
  - `filledLoaded`: how many full bottles the driver put on the van
  - `emptyReceived`: empty bottles collected from depot/storage before leaving
  - Sheet status → `LOADED`
- **Purpose:** Creates the starting inventory baseline for reconciliation later

#### Step 3 — Deliveries (Driver on route)
- **Who:** DRIVER
- **Action:** For each customer stop → `PATCH /daily-sheets/:id/items/:itemId`
  ```json
  {
    "status": "COMPLETED",
    "filledDropped": 2,
    "emptyReceived": 1,
    "cashCollected": 300
  }
  ```
- **What happens per delivery:**
  - `DailySheetItem` updated with delivery details
  - If CASH customer: `cashCollected` recorded
  - If MONTHLY customer: `cashCollected` is typically 0 (billed monthly)
  - Driver can mark as `RESCHEDULED` or `CANCELLED` with a reason if customer not home
- **Sheet status stays:** `LOADED` during deliveries

#### Step 4 — Check In (Driver returns load trip)
- **Who:** DRIVER
- **Action:** `PATCH /daily-sheets/:id/loads/:loadId/checkin { returnedFilled, collectedEmpty, cashHandedIn }`
- **What happens:**
  - Records end-of-trip inventory: bottles returned to depot
  - `cashHandedIn`: total cash driver is handing in for this trip
  - Load trip `endedAt` is set
  - Multiple trips per sheet are supported (multi-trip model)

#### Step 5 — Close Sheet (Admin reviews & closes)
- **Who:** VENDOR_ADMIN or STAFF
- **Action:** `POST /daily-sheets/:id/close`
- **What happens (backend):**
  1. Calculates reconciliation:
     - `bottleDiscrepancy = filledLoaded - filledDropped - filledReturned`
     - `cashDiscrepancy = cashCollected - cashHandedIn`
  2. For each **COMPLETED** delivery item:
     - Creates a `Transaction` record (type: `DELIVERY`)
     - Updates customer's `financialBalance` (adds amount owed for MONTHLY customers)
     - Updates customer's `BottleWallet` (decrements empty bottles, increments filled)
  3. Sheet status → `CLOSED`
  4. Returns reconciliation report in response
- **Frontend:** Shows reconciliation dialog with discrepancies

---

## 3. Driver Journey (A to Z)

```
Login → See Today's Sheet → Load Van → Drive Route → Deliver → Check In → Done
```

### Detailed steps

**1. Login**
- Opens vendor-dashboard (or driver app)
- `POST /auth/login { email, password }`
- Gets JWT token → stored in cookie
- Redirected to dashboard

**2. See Assigned Sheet**
- `GET /daily-sheets?date=today&driverId=me`
- Sees their route sheet: list of customers with addresses and delivery notes
- Can see: customer name, address, delivery days, product quantities expected

**3. Load Out**
- At the depot before leaving
- Records how many filled bottles loaded onto van
- Records empty bottles received at depot
- `PATCH /daily-sheets/:id/load-out`

**4. Drive to Each Customer**
- Sheet shows customers in route order
- For each stop:
  - Records `filledDropped` (bottles left with customer)
  - Records `emptyReceived` (empty bottles collected from customer)
  - If CASH customer: records `cashCollected`
  - If customer not home: marks `RESCHEDULED` or `CANCELLED`

**5. Check In (End of Day)**
- Returns to depot
- Records `filledReturned` (unused full bottles back)
- Records `emptyReturned` (all empties back to depot)
- Records `cashHandedIn` (cash given to admin)

**6. Sheet Complete**
- Admin reviews and closes the sheet
- Any discrepancies are flagged (missing cash, missing bottles)

---

## 4. Customer Lifecycle

```
Created → Assigned to Route → Deliveries Start → Balance Accumulates → Payment → Active/Inactive
```

### Creation
- **Who:** VENDOR_ADMIN or STAFF
- `POST /customers`
- Required: name, phone, address, routeId, paymentType (CASH/MONTHLY), deliveryDays
- Optional: customerCode (auto-generated if not provided)
- On creation:
  - `isActive: true`
  - `financialBalance: 0`
  - `BottleWallet` records created for each product (balance: 0)

### Getting Deliveries
- Customer appears on daily sheet whenever their `deliveryDays` includes today's weekday
- Each completed delivery updates their bottle wallet and financial balance

### Balance Accumulation
- **CASH:** Balance stays near 0 (paid on delivery each time)
- **MONTHLY:** Balance grows with each delivery, customer pays once a month via portal

### Deactivation
- `PATCH /customers/:id/deactivate` → `isActive: false`
- Deactivated customers are **excluded** from daily sheet generation
- Can be reactivated: `PATCH /customers/:id/reactivate`

### Customer Portal Access
- Vendor can create portal account: `POST /customers/:id/portal-account { phone, password }`
- Customer can then login to the portal and view balance, deliveries, make payments
- Portal access can be revoked: `DELETE /customers/:id/portal-account`

---

## 5. Payment Flow — CASH Customer

```
Delivery → Driver collects cash → Recorded on sheet → Sheet closed → Transaction created
```

1. Driver arrives at customer, drops bottles
2. Customer pays cash on the spot
3. Driver records `cashCollected` on the delivery item
4. At end of day, driver hands in total cash
5. When sheet is **closed**:
   - `Transaction` created: `type: DELIVERY, amount: cashCollected`
   - Customer's `financialBalance` updated (typically stays 0 for CASH)
6. If customer didn't pay: balance goes negative (they owe money)

---

## 6. Payment Flow — MONTHLY Customer

```
Deliveries all month → Balance grows → Customer pays via portal → Admin approves → Balance cleared
```

1. Customer gets deliveries throughout the month
2. Each delivery adds to their `financialBalance` (they owe this much)
3. End of month: customer logs into portal
4. Sees outstanding balance on dashboard
5. Chooses payment method:
   - **Raast QR:** Paymob generates QR → customer scans → status polls every 3s → auto-confirmed
   - **Manual Screenshot:** Customer uploads screenshot → status: `PENDING_REVIEW`
6. Admin reviews manual payments: `PATCH /payment-requests/:id/approve` or `/reject`
7. On approval:
   - `Transaction` created: `type: PAYMENT`
   - Customer's `financialBalance` decremented by payment amount
8. Customer gets notified (FCM push notification + optional WhatsApp)

---

## 7. Customer Portal Flow

**App:** `apps/customer-portal` (separate Next.js app)

```
Login → Home (balance) → Make Payment → View History → View Deliveries
```

### Auth
- `POST /auth/login` — same endpoint, customer has a User record with `DRIVER` role? No — customers have their own portal credentials tied to their customer record
- Portal-specific endpoints all under `/portal/*`

### Home / Dashboard
- `GET /portal/me` — profile: name, address, paymentType, customerCode
- `GET /portal/balance` — financial balance + bottle wallet per product + effective prices

### Making a Payment
- User taps "Pay Now"
- Enters amount
- Selects method (Raast QR or Manual)
- **Raast QR path:**
  1. `POST /portal/payment-requests { amount, method: RAAST }`
  2. Backend calls Paymob API → returns QR image URL + `qrExpiresAt`
  3. Frontend shows QR with countdown timer
  4. Frontend polls `GET /portal/payments/:id` every 3s
  5. When status = `PAID` → show success screen + updated balance
- **Manual path:**
  1. `POST /portal/payment-requests { amount, method: MANUAL }` with screenshot upload
  2. Status → `PENDING_REVIEW`
  3. Customer sees "Under Review" screen
  4. Vendor admin approves/rejects from vendor dashboard

### History
- `GET /portal/deliveries` — delivery history with dates, quantities, status
- `GET /portal/payments` — all payment requests with statuses
- `GET /portal/statement?month=YYYY-MM` — monthly PDF statement download
- `GET /portal/schedule?from=&to=` — upcoming delivery schedule

---

## 8. Bottle Wallet System

Every customer has a **BottleWallet** per product — tracks how many empty bottles are at the customer's location.

```
Delivery → filledDropped ↑, emptyReceived ↓ from wallet
```

### How it works

| Event | Wallet Change |
|-------|--------------|
| Driver drops 2 filled 19L bottles | `wallet.balance += 2` (customer now has 2 bottles) |
| Driver collects 1 empty from customer | `wallet.balance -= 1` |
| Net per delivery | `balance += filledDropped - emptyReceived` |

### Why it matters
- Tracks bottle accountability — vendor knows how many bottles are "out in the field"
- High wallet balance = customer has many bottles, may not need delivery
- Can generate consumption stats: `GET /customers/:id/consumption`

### Consumption Stats
- `avgFilledPerDelivery`: average bottles dropped per visit
- `consumptionRate`: how fast customer goes through bottles (helps with scheduling)

---

## 9. Balance Reminder Flow

Automatically notifies customers with outstanding balances.

```
Schedule configured → Cron fires → Filter customers above threshold → Send WhatsApp/SMS
```

1. Vendor admin configures: `POST /balance-reminders/schedule`
   - `minBalance`: only remind customers who owe more than this
   - `cronExpression`: when to run (e.g., `0 9 * * 1` = every Monday 9AM)
2. Cron job fires at scheduled time
3. System queries all customers where `financialBalance >= minBalance`
4. For each: sends WhatsApp message (if enabled) with their outstanding amount
5. Admin can also trigger manually: `POST /balance-reminders/send-now`
6. Dry run available: preview which customers would be messaged before actually sending

---

## 10. Expense Tracking Flow

```
Expense recorded → Categorized → Shown in Analytics (Revenue - Expenses = Profit)
```

1. VENDOR_ADMIN or STAFF creates expense: `POST /expenses`
   - `amount`, `category` (FUEL / MAINTENANCE / SALARY / REPAIR / OTHER)
   - `description`, `date`, optional `vanId` (if expense is for a specific van)
2. Expenses list with filters: `GET /expenses?category=FUEL&from=&to=&vanId=`
3. Summary endpoint: `GET /expenses/summary`
   - Totals by category
   - Gross profit = total revenue - total expenses (for the period)
4. Expenses feed into Analytics financial tab charts

---

## 11. Analytics Flow

```
Date range selected → 4 parallel API calls → Charts rendered → Optional CSV/PDF export
```

### Data Sources
All analytics are computed server-side from raw Prisma queries (no pre-aggregation).

| Tab | Endpoint | Data |
|-----|----------|------|
| Financial | `GET /analytics/financial?from=&to=` | Revenue, expenses, profit, by route, CASH/MONTHLY split, collection rate |
| Deliveries | `GET /analytics/deliveries?from=&to=` | Completion rate, by day, by weekday, by route, missed reasons |
| Customers | `GET /analytics/customers?from=&to=` | Growth over 12 months, payment type split, top by revenue, highest balances |
| Staff | `GET /analytics/staff?from=&to=` | Per-driver deliveries, cash collected, completion rate leaderboard |

### Caching
- Each response cached in Redis for 120 seconds with key: `vendor:{id}:analytics:{endpoint}:{from}:{to}`
- Cache invalidated when relevant data changes (sheets closed, payments approved, etc.)

### Export
- **CSV:** Pure frontend — converts current tab data to comma-separated string → blob download
- **PDF:** jspdf + jspdf-autotable (dynamically imported) → formatted report with summary tables

---

## 12. Auth & Session Flow

```
Login → Access Token (15min) + Refresh Token (7d) → Auto-refresh → Logout
```

### Login
1. `POST /auth/login { email, password }`
2. Backend returns:
   - `access_token` (JWT, 15 min expiry) → stored in `httpOnly` cookie
   - `refresh_token` (opaque, 7 days) → stored in `httpOnly` cookie, saved in Redis
3. All subsequent requests send cookie automatically

### Token Refresh
1. When access token expires → `POST /auth/refresh` (sends refresh token cookie)
2. Backend validates refresh token in Redis
3. Returns new `access_token` + rotated `refresh_token` (old one deleted from Redis)
4. Old refresh token is invalidated (rotation prevents replay attacks)

### Password Reset
1. `POST /auth/forgot-password { email }` → sends reset email (Gmail SMTP)
2. Email contains link with reset token (valid 1 hour)
3. `POST /auth/reset-password { token, newPassword }` → updates password + sends confirmation email

### Change Password (while logged in)
- `PATCH /users/me/change-password { currentPassword, newPassword }`
- Verifies current password with bcrypt before updating

### Logout
- `POST /auth/logout` → deletes refresh token from Redis
- Frontend clears cookies + redirects to login

### RBAC (Role-Based Access Control)
- Every protected endpoint has `@Roles(...)` decorator
- `RolesGuard` checks JWT payload role against required roles
- `vendorId` from JWT ensures tenant isolation — users can only see their own vendor's data

---

## Data Relationships (Quick Reference)

```
Vendor
  ├── Users (VENDOR_ADMIN, STAFF, DRIVER)
  ├── Products (19L, 5L, etc.)
  ├── Vans (plate numbers, assigned drivers)
  ├── Routes (DHA, Gulshan, Malir — each has a defaultVan)
  ├── Customers
  │     ├── BottleWallets (one per product)
  │     ├── CustomerProductPrices (custom pricing)
  │     ├── Transactions (DELIVERY, PAYMENT, ADJUSTMENT)
  │     └── PaymentRequests (portal payments)
  ├── DailySheets (one per route per day)
  │     └── DailySheetItems (one per customer on that route)
  ├── Expenses (operational costs)
  ├── BalanceReminderSchedule
  └── AuditLogs (all create/update/delete actions)
```

---

*Last updated: February 26, 2026 — updated generation flow from route-centric to van-centric (FE-ROUTE-007)*
