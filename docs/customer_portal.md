# App Detail: Customer Portal

**Path:** `apps/customer-portal`
**Target Audience:** End Customers receiving water delivery services.

---

## 1. Core Modules & Features

### 🏦 Wallet & Financials
- **Balance Overview:** High-end balance card showing outstanding amount with real-time updates.
- **Fintech Experience:** Color-coded stats for "Total Paid" and "Last Payment" using ₨ currency formatting.
- **Inventory Tracking:** Visual "Bottles at Home" progress bar to track current physical inventory.

### 💳 Online Payments
- **Raast QR (Automated):** Integrated Paymob-powered Raast QR generation. Scan and pay instantly from any banking app.
- **Manual Transfers:** UI for reporting IBFT, JazzCash, or Easypaisa transfers with reference number and screenshot upload.
- **History:** Full paginated ledger of all credits (payments) and debits (deliveries).

### 👤 Account & Profile
- **Personal Details:** Verified account status with easy-to-read contact and address information.
- **Delivery Schedule:** Visual Mon-Sun badges showing assigned delivery days.
- **Account Statements:** Quick-access button to download financial history.

---

## 2. Technical Implementation

### State & Data
- **Server State:** TanStack Query v5 for efficient data fetching and caching.
- **Client State:** Zustand for persistent user sessions.
- **Polling:** Integrated real-time polling for checking automated payment (QR) status.

### Styling & UI
- **Framework:** Tailwind CSS + modernized shadcn/ui components.
- **Mobile-First:** Fixed bottom navigation bar for a native app feel on smartphones.
- **Animations:** Framer Motion for smooth tab switches, staggered list entries, and modal transitions.
- **Theming:** Full Light/Dark mode support using `next-themes`.
- **Font:** Inter (Sans-serif).

---

## 3. UX Design Principles
- **Native Look:** Designed to feel like a mobile application rather than a website.
- **Transparency:** Clear view of physical inventory (bottles) vs. financial balance.
- **Simplicity:** One-tap navigation between Home, Transactions, and Profile.
