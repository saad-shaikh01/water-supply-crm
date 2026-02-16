# App Detail: Admin Panel (Super Admin)

**Path:** `apps/admin-panel`
**Target Audience:** Platform Owners / Super Administrators.

---

## 1. Core Modules & Features

### 🏢 Vendor Management
- **Vendor Onboarding:** Create new water supply businesses on the platform.
- **Access Control:** Suspend or unsuspend vendors in real-time.
- **Health Monitoring:** View customer and driver counts for each vendor.

### 📊 Platform Analytics
- **KPI Overview:** Total Vendors, Total Customers, and Platform-wide Revenue.
- **Activity Tracking:** Real-time monitoring of active vendors.

### ⚙️ System Settings
- Global configuration for the platform.
- Admin account management.

---

## 2. Technical Implementation

### State & Data
- **Server State:** TanStack Query v5.
- **Client State:** Zustand with persistence for super admin sessions.

### Styling & UI
- **Framework:** Tailwind CSS + modernized shadcn/ui components.
- **Theming:** Full Light/Dark mode support.
- **Glassmorphism:** Consistent sidebar and header styling with the rest of the ecosystem.
- **Font:** Inter (Sans-serif).

---

## 3. Security
- **RBAC:** Restricted strictly to the `SUPER_ADMIN` role.
- **Real-time Suspension:** When a vendor is suspended here, all its users are instantly blocked across all apps via a Redis-backed session invalidation layer.
