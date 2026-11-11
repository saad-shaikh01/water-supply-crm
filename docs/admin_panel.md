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

### ⚙️ Platform Settings (`/settings`)
- **Maintenance mode:** one switch (with confirm dialog, message and ETA). While ON, every non-platform-admin API request gets `503 MAINTENANCE_MODE`; health checks, sign-in, `GET /platform/status` and inbound webhooks are exempt. The admin panel shows an amber banner and keeps working; the vendor dashboard and customer portal show a full-screen notice (`MaintenanceGate`).
- **Feature flags / Defaults / Security policy:** registry-backed settings (`flags.*`, `defaults.customerGroupingEnabled` for NEW vendors only, `security.require2faForSuperAdmin`, `security.loginMaxAttempts`, `security.loginLockMinutes`).

### 👥 Platform Administrators (`/settings/admins`)
- Create (temporary password shown once), deactivate (reason required; never yourself or the last active admin), reactivate, reset password (email link or temporary password), reset 2FA, unlock a locked account. Every action is audited.

### 🔐 Security (`/settings/security`)
- **TOTP two-factor authentication:** QR enrollment, 10 single-use recovery codes (shown once), regenerate, disable. When `security.require2faForSuperAdmin` is ON, admins without 2FA are forced to enroll at sign-in. Secrets are AES-256-GCM encrypted (`ADMIN_2FA_ENC_KEY`).
- **Sessions:** list your signed-in devices and revoke any of them (effective immediately).
- Lost authenticator and recovery codes: another admin resets your 2FA, or on the server `node scripts/reset-admin-2fa.cjs --email <admin> --yes` (dry run without `--yes`).

### Environment
| Variable | Purpose |
|---|---|
| `ADMIN_2FA_ENC_KEY` | 32 random bytes, base64. Required in production (API refuses to boot without it). |
| `ADMIN_FRONTEND_URL` | Admin panel base URL; platform-admin password-reset emails link to `${ADMIN_FRONTEND_URL}/auth/reset-password`. |
| `CSP_REPORT_ONLY` | `true` ships the admin panel CSP as `Content-Security-Policy-Report-Only` (default: enforced). |

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
