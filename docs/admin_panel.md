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

---

## 4. Super-Admin Impersonation (Phase 4)
A SUPER_ADMIN can open the vendor dashboard "as" a vendor's VENDOR_ADMIN for support.

- **Start:** `POST /platform/impersonation` `{vendorId, targetUserId?, reason (10-500 chars, mandatory), mode: READ_ONLY|SUPPORT, ttlMinutes: 15|30|60}` (throttled 5/min). Refuses SUPER_ADMIN/non-admin/cross-vendor/inactive targets and suspended vendors. Returns a `handoffUrl` carrying only a one-time code (60 s, single use); the token is never in the URL.
- **Handoff:** the vendor dashboard page `/auth/impersonate?code=...` calls `POST /auth/impersonation/exchange` and stores session cookies (no maxAge) plus an `impersonating=1` marker. No refresh token is ever issued; `/auth/refresh` cannot extend a session.
- **Token:** JWT (15-60 min) with `imp:{sid,actorId,actorName,mode}`; `JwtStrategy` requires the Redis key `imp:active:{sid}` on every request (fail closed: exit, revoke, expiry and a Redis flush all end the session) and that the actor is still active.
- **Guard:** `ImpersonationGuard` (after `PermissionsGuard`): READ_ONLY allows GET/HEAD/OPTIONS only (plus exit); routes marked `@BlockWhenImpersonating()` return 403 `IMPERSONATION_FORBIDDEN` in every mode (password change, user/role/permission writes, import execute/revert, vendor delete/wipe/reset-admin-password, WhatsApp credential changes, FCM token, portal notification read, payroll settlement). `impersonation-route-inventory.spec.ts` pins the exact list.
- **Exit / revoke:** `POST /auth/impersonation/exit`; `POST /platform/impersonation/:id/revoke`; `GET /platform/impersonation` lists sessions. A new session for the same actor and vendor supersedes the old one.
- **Audit:** `IMPERSONATION_START|EXCHANGE|END|REVOKE|FORBIDDEN` and `IMPERSONATED_REQUEST` rows (with `vendorId`, so the vendor sees them); every audit row written during an impersonated request gets `changes.impersonatedBy`.
- **UI:** the vendor dashboard shows a persistent banner (actor, mode, countdown, Exit); on expiry or a dead session it lands on "Support session ended". Cookies are per host, so a support session replaces a real vendor login in the same browser: use a separate browser profile.
- **Env:** `VENDOR_DASHBOARD_URL` (handoff base URL), `IMPERSONATION_MAX_TTL_MIN` (cap, max 60).
