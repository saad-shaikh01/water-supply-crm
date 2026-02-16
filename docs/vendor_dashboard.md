# App Detail: Vendor Dashboard

**Path:** `apps/vendor-dashboard`
**Target Audience:** Vendor Admins, Office Staff, and Delivery Drivers.

---

## 1. Core Modules & Features

### 📦 Customer Management
- **Onboarding:** Slide-over form with Mon-Sun delivery schedule selector and customer code generation.
- **Search & Filter:** Instant search by name/code/phone + Route filtering (powered by `nuqs`).
- **Profile Hub:** Deep-dive view showing:
  - Financial Balance (Credit/Debit color-coded).
  - Bottle Wallets (Inventory per product).
  - Custom Pricing (Customer-specific rates).
  - Transaction History.

### 📝 Daily Operations (The Engine)
- **Async Generation:** Offloads sheet creation to BullMQ; frontend polls for status with a progress bar.
- **Lifecycle Management:**
  1. **LOAD-OUT:** Record filled bottles dispatched from the warehouse.
  2. **DELIVERY:** Real-time entry of drops, receives, and cash collected.
  3. **CHECK-IN:** Record returning filled/empty bottles and total cash.
  4. **RECONCILIATION:** Close sheet to generate a discrepancy report.
- **PDF Export:** A4 printable format for all operational sheets.

### 💰 Financials & Payments
- **Payment Requests:** Dedicated queue for admins to review manual bank/JazzCash/Easypaisa transfer screenshots.
- **Ledger:** Global transaction list with ₨ currency formatting and description search.
- **Revenue Analytics:** Weekly revenue chart on the overview page using `Recharts`.

### 🚛 Driver Tracking (Real-time)
- **SSE Integration:** Live driver location updates on the dashboard (uses Server-Sent Events).
- **Mobile Optimized:** Large touch-friendly inputs for drivers recording deliveries on the road.

---

## 2. Technical Implementation

### State & Data
- **Server State:** TanStack Query v5 with centralized query keys in `lib/query-keys.ts`.
- **Client State:** Zustand with persistence for auth sessions.
- **URL State:** `nuqs` used for all table pagination and filtering to ensure shareable links.

### Styling & UI
- **Framework:** Tailwind CSS + custom shadcn/ui components.
- **Animations:** `framer-motion` for staggered list entries and lifecycle transitions.
- **Theming:** Full Light/Dark mode support.
- **Font:** Inter (Sans-serif).

---

## 3. RBAC (Access Control)
- **VENDOR_ADMIN:** Full access to all modules, including user management and payment approvals.
- **STAFF:** Access to operational modules (Customers, Sheets, Transactions). Cannot manage other users.
- **DRIVER:** restricted access. Auto-redirected to `/dashboard/daily-sheets`. Can only view assigned sheets and record deliveries.
