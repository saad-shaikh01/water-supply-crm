# @water-supply-crm/authz

Framework-agnostic **single source of truth** for the RBAC permission system, imported by
both the NestJS backend and the Next.js vendor-dashboard.

- **`PERMISSION_CATALOG`** — the frozen catalog (`resource → { label, navigable, actions }`).
- **`Permission`** — precise string-literal union of every valid permission, derived from the catalog.
- **`PERMISSIONS` / `PERMISSION_SET` / `PAGE_PERMISSIONS`** — runtime lists + membership set.
- **`isPermission()` / `splitPermission()`** — validation + parsing helpers.
- **`PERMISSION_GROUPS` / `ACTION_LABELS`** — UI metadata for the permission-management matrix.
- **`PAGE_REGISTRY` / `pagePermissionForPath()`** — route → `:page` mapping (nav + route guards + middleware).

Canonical spec: [`docs/rbac-permission-catalog.md`](../../../docs/rbac-permission-catalog.md) (🧊 frozen).
Do **not** rename permissions without explicit owner approval. The spec test enforces the frozen totals.

_Added in Phase A (RBAC). Presets, the effective-permission resolver, and the wildcard matcher
arrive in Phase A2._
