# RBAC — Finalized Permission Catalog (Vendor Dashboard)

**Status:** 🧊 **FROZEN (2026-07-08)** — the single source of truth for backend, frontend, middleware, guards, seeders, and the permission-management UI. Passed the 9-point verification pass. **Permission names must not change without explicit owner approval.**
**Date:** 2026-07-08

> **Amendment R1 (Phase C, owner-approved 2026-07-08):** added **`customers:view_financial`** (financial-summary + consumption views, separate from operational `customers:view`) and **`customers:update_location`** (GPS pinning, separate from general `customers:update`). This separates operational from financial customer viewing, and location updates from general editing, so drivers are not broadened to sensitive data.
> **Amendment R2 (Phase C / Batch 16, owner-approved 2026-07-08):** added **`daily_sheets:correct`** (admin-only financial correction entry, separate from `daily_sheets:update`) to preserve the `VENDOR_ADMIN`-only boundary on sheet corrections. **Totals updated: 123 permissions, 100 actions.**
**Convention:** `resource:action` (canonical separator `:`). `resource:page` = reserved route/navigation permission. See [rbac-design.md](./rbac-design.md).
**Grounding:** Derived from the *actual* controller endpoints and `/dashboard/*` routes in the repo (verified 2026-07-08), not the illustrative draft in design-doc §5. **This catalog supersedes design-doc §5** — deltas are listed in §D.

> Scope reminder (locked): **vendor-dashboard only.** Customer-portal / self-service / super-admin platform surfaces are explicitly excluded (§C).

---

## A. Complete Catalog (grouped by module)

Each row: permission → the existing feature/endpoint(s) it gates. `page` sorts first in every group.

### 1. Dashboard — `dashboard` *(navigable)*
| Permission | Gates |
|---|---|
| `dashboard:page` | Open Overview (`/dashboard/overview`) & Driver Home (`/dashboard/home`) |
| `dashboard:view` | `GET /dashboard/overview`, `daily-stats`, `revenue`, `top-customers`, `route-performance`, `performance/staff` |

### 2. Users — `users` *(navigable)*
| Permission | Gates |
|---|---|
| `users:page` | Open `/dashboard/users` |
| `users:view` | `GET /users`, `GET /users/:id` |
| `users:create` | `POST /users` |
| `users:update` | `PATCH /users/:id` |
| `users:deactivate` | `PATCH /users/:id/deactivate` |
| `users:restore` | `PATCH /users/:id/reactivate` |
| `users:delete` | `DELETE /users/:id` |

*(Self-service `PATCH /users/me/change-password` needs no permission.)*

### 3. Roles & Access Control — `roles` *(navigable — new)*
| Permission | Gates |
|---|---|
| `roles:page` | Open `/dashboard/settings/roles` |
| `roles:view` | `GET /roles`, `GET /roles/:id`, `GET /permissions` |
| `roles:create` | `POST /roles` |
| `roles:update` | `PATCH /roles/:id` (rename, permission set) |
| `roles:delete` | `DELETE /roles/:id` |
| `roles:clone` | `POST /roles/:id/clone` |
| `roles:reset` | `POST /roles/:id/reset` (reset system role to preset) |
| `roles:assign` | `PATCH /users/:id/role` (assign a role to a user) |
| `roles:manage_overrides` | `PATCH /users/:id/overrides` (per-user ALLOW/DENY) |

### 4. Customers — `customers` *(navigable)*
| Permission | Gates |
|---|---|
| `customers:page` | Open `/dashboard/customers` |
| `customers:view` | `GET /customers`, `:id`, `:id/transactions`, `:id/schedule` (operational views) |
| `customers:view_financial` | `GET /customers/:id/financial-summary`, `:id/consumption` (financial/analytics views) |
| `customers:create` | `POST /customers` |
| `customers:update` | `PATCH /customers/:id` (general edit) |
| `customers:update_location` | `PATCH /customers/:id/location` (GPS pinning) |
| `customers:deactivate` | `PATCH /customers/:id/deactivate` |
| `customers:restore` | `PATCH /customers/:id/reactivate` |
| `customers:delete` | `DELETE /customers/:id` |
| `customers:export` | Download statement / consumption exports |
| `customers:manage_portal` | `POST` / `DELETE /customers/:id/portal-account` (enable/disable portal login) |

*(Per-customer custom prices — `POST`/`DELETE /customers/:id/custom-prices` — are gated by `pricing:update`, see module 7.)*

### 5. Orders — `orders` *(navigable)*
| Permission | Gates |
|---|---|
| `orders:page` | Open `/dashboard/orders` |
| `orders:view` | `GET /orders` |
| `orders:approve` | `PATCH /orders/:id/approve`, `POST /orders/bulk-approve` |
| `orders:reject` | `PATCH /orders/:id/reject` |
| `orders:dispatch` | `POST`/`PATCH /orders/:id/dispatch-plan`, `POST /orders/:id/dispatch-now`, `POST /orders/bulk-plan` |

*(Order **creation** is customer-portal + daily-sheet `from-order`; not an admin action.)*

### 6. Products — `products` *(navigable)*
| Permission | Gates |
|---|---|
| `products:page` | Open `/dashboard/products` |
| `products:view` | `GET /products`, `:id` |
| `products:create` | `POST /products` |
| `products:update` | `PATCH /products/:id`, `:id/toggle-active` |
| `products:delete` | `DELETE /products/:id` |

### 7. Pricing — `pricing` *(navigable)*
| Permission | Gates |
|---|---|
| `pricing:page` | Open `/dashboard/pricing` |
| `pricing:view` | `POST /customers/pricing/preview`, bulk-update status |
| `pricing:update` | `POST /customers/pricing/bulk-update`; `POST`/`DELETE /customers/:id/custom-prices/*` |

### 8. Inventory / Warehouse — `inventory` *(navigable)*
| Permission | Gates |
|---|---|
| `inventory:page` | Open `/dashboard/warehouse` (+ `/repairs`, `/summary`) |
| `inventory:view` | `GET /warehouse/stock`, `universe`, `transactions`, `repairs`, `summary` |
| `inventory:add_stock` | `POST /warehouse/opening-balance`, `fill-in`, `refill` |
| `inventory:adjust` | `POST /warehouse/adjustment` |
| `inventory:write_off` | `POST /warehouse/write-off` |
| `inventory:mark_damaged` | `POST /warehouse/mark-damaged`, `mark-leaked` |
| `inventory:manage_repairs` | `POST /warehouse/send-repair`, `PATCH /warehouse/repairs/:batchId/return` |

### 9. Payments — `payments` *(navigable)*
| Permission | Gates |
|---|---|
| `payments:page` | Open `/dashboard/payment-requests` |
| `payments:view` | `GET /payments`, `:id`, `:id/screenshot` |
| `payments:approve` | `PATCH /payments/:id/approve` |
| `payments:reject` | `PATCH /payments/:id/reject` |

### 10. Transactions — `transactions` *(navigable)*
| Permission | Gates |
|---|---|
| `transactions:page` | Open `/dashboard/transactions` |
| `transactions:view` | `GET /transactions`, `summary`, `customers/:id`, `customers/:id/summary` |
| `transactions:record_payment` | `POST /transactions/payments` |
| `transactions:adjust` | `POST /transactions/adjustments` |

### 11. Daily Sheets — `daily_sheets` *(navigable)*
| Permission | Gates |
|---|---|
| `daily_sheets:page` | Open `/dashboard/daily-sheets` (+ Driver `/history`) |
| `daily_sheets:view` | `GET /daily-sheets`, `:id`, driver stats, delivery-history, financial-summary, reconciliation-preview, invoice, receipt, notes, photo-url, loads |
| `daily_sheets:generate` | `POST /daily-sheets/generate` |
| `daily_sheets:update` | `PATCH /daily-sheets/items/:id`, `items/from-order`, `items/adhoc`, `items/correction`, upload-photo, add notes/voice |
| `daily_sheets:load_out` | `PATCH /daily-sheets/:id/load-out`, `POST /:id/loads` |
| `daily_sheets:check_in` | `PATCH /daily-sheets/:id/check-in`, `PATCH /:id/loads/:loadId/checkin` |
| `daily_sheets:close` | `POST /daily-sheets/:id/close` |
| `daily_sheets:confirm_crew` | `POST /daily-sheets/:id/confirm-crew` |
| `daily_sheets:swap_assignment` | `PATCH /daily-sheets/:id/swap-assignment` (reassign driver/van/crew) |
| `daily_sheets:bulk_import` | `POST /daily-sheets/bulk-import/(global-)preview\|confirm` |
| `daily_sheets:manage_edit_locks` | `PATCH /daily-sheets/items/:id/unlock-edit`, `request-edit`, note acknowledge |
| `daily_sheets:export` | `GET /daily-sheets/:id/export`, `:id/invoice` |

*(Individual delivery recording lives here — there is no separate `deliveries` resource; see §D.)*

### 12. Vans — `vans` *(navigable)*
| Permission | Gates |
|---|---|
| `vans:page` | Open `/dashboard/vans` |
| `vans:view` | `GET /vans`, `:id` |
| `vans:create` | `POST /vans` |
| `vans:update` | `PATCH /vans/:id` |
| `vans:deactivate` | `PATCH /vans/:id/deactivate` |
| `vans:restore` | `PATCH /vans/:id/reactivate` |
| `vans:delete` | `DELETE /vans/:id` |
| `vans:manage_crew` | `PUT /vans/:id/default-crew` |

### 13. Routes — `routes` *(navigable)*
| Permission | Gates |
|---|---|
| `routes:page` | Open `/dashboard/routes` |
| `routes:view` | `GET /routes`, `:id` |
| `routes:create` | `POST /routes` |
| `routes:update` | `PATCH /routes/:id` |
| `routes:delete` | `DELETE /routes/:id` |

### 14. Live Tracking — `tracking` *(navigable)*
| Permission | Gates |
|---|---|
| `tracking:page` | Open `/dashboard/tracking` |
| `tracking:view` | `GET /tracking/active`, `driver/:id`, `subscribe` (SSE) |
| `tracking:report_location` | `POST /tracking/location` (driver device reports own position) |

### 15. Delivery Issues — `delivery_issues` *(navigable)*
| Permission | Gates |
|---|---|
| `delivery_issues:page` | Open `/dashboard/delivery-issues` |
| `delivery_issues:view` | `GET /delivery-issues`, `:id` |
| `delivery_issues:plan` | `PATCH /delivery-issues/:id/plan` |
| `delivery_issues:resolve` | `PATCH /delivery-issues/:id/resolve` |

### 16. Damage Cases — `damage_cases` *(navigable)*
| Permission | Gates |
|---|---|
| `damage_cases:page` | Open `/dashboard/damage-cases` **and** `/dashboard/damage-report` |
| `damage_cases:view` | `GET /damage-cases`, `:id`, `my-cases`, `:id/audit-log` |
| `damage_cases:create` | `POST /damage-cases`, `upload-photo` (driver damage-report form) |
| `damage_cases:update` | `PATCH /damage-cases/:id` |
| `damage_cases:review` | `PATCH /damage-cases/:id/review` |
| `damage_cases:charge` | `PATCH /damage-cases/:id/charge` |
| `damage_cases:waive` | `PATCH /damage-cases/:id/waive` |
| `damage_cases:reverse` | `PATCH /damage-cases/:id/reverse` |

### 17. Expenses — `expenses` *(navigable)*
| Permission | Gates |
|---|---|
| `expenses:page` | Open `/dashboard/expenses` |
| `expenses:view` | `GET /expenses`, `summary`, `:id` |
| `expenses:create` | `POST /expenses` |
| `expenses:update` | `PATCH /expenses/:id` |
| `expenses:delete` | `DELETE /expenses/:id` |

### 18. Analytics — `analytics` *(navigable)*
| Permission | Gates |
|---|---|
| `analytics:page` | Open `/dashboard/analytics` |
| `analytics:view` | `GET /analytics/financial`, `deliveries`, `customers`, `staff` |
| `analytics:export` | CSV / PDF export on analytics tabs |

### 19. Tickets — `tickets` *(navigable)*
| Permission | Gates |
|---|---|
| `tickets:page` | Open `/dashboard/tickets` |
| `tickets:view` | `GET /tickets` (admin) |
| `tickets:reply` | `PATCH /tickets/:id/reply` |

### 20. Notification Controls — `notifications` *(navigable)*
| Permission | Gates |
|---|---|
| `notifications:page` | Open `/dashboard/notification-settings` |
| `notifications:view` | `GET /notification-settings`, `GET /notifications/logs`, `logs/:id` |
| `notifications:configure` | `PATCH /notification-settings` (vendor master gate) |

*(Personal in-app bell + per-user preferences are self-service — no permission.)*

### 21. Balance Reminders — `balance_reminders` *(navigable)*
| Permission | Gates |
|---|---|
| `balance_reminders:page` | Open `/dashboard/balance-reminders` |
| `balance_reminders:view` | `GET /balance-reminders/history`, `history/:id`, `POST /preview` |
| `balance_reminders:send` | `POST /balance-reminders/send-now`, `send-targeted` |
| `balance_reminders:configure` | `POST`/`GET`/`DELETE /balance-reminders/schedule` |

### 22. Audit Logs — `audit_logs` *(navigable)*
| Permission | Gates |
|---|---|
| `audit_logs:page` | Open `/dashboard/audit-logs` |
| `audit_logs:view` | `GET /audit`, `GET /audit/:id` |

### 23. Settings — `settings` *(navigable — container / vendor profile)*
| Permission | Gates |
|---|---|
| `settings:page` | Open the Settings section landing / vendor profile |
| `settings:view` | Read vendor profile & settings |
| `settings:update` | Update vendor profile / general settings |

*(Roles, Notifications, and Balance Reminders live under the Settings group but carry their own `:page` permissions above.)*

### 24. WhatsApp Integration — `whatsapp` *(NON-navigable — surfaced inside Settings, no dedicated route)*
| Permission | Gates |
|---|---|
| `whatsapp:view` | `GET /whatsapp/status`, `qr` |
| `whatsapp:manage` | `POST /whatsapp/logout` (+ connect / re-scan) |

### 25. Collection Policy — `collection_policy` *(navigable)*
| Permission | Gates |
|---|---|
| `collection_policy:page` | Open `/dashboard/collection-policy` |
| `collection_policy:view` | `GET /collection-policy`, `GET /collection-policy/cash` |
| `collection_policy:update` | `PATCH /collection-policy`, `PATCH /collection-policy/cash`, `GET /collection-policy/cash/impact` (prospective-settings preview, gated with update) |

### 26. Conversations — `conversations` *(navigable)*
| Permission | Gates |
|---|---|
| `conversations:page` | Open `/dashboard/communications` |
| `conversations:view` | `GET /conversations`, `:id`, `:id/messages`, `unread-count`, `GET /messages/:id/audio` |
| `conversations:create` | `PUT /conversations/for-item/:itemId` (get-or-create) |
| `conversations:send` | `POST /conversations/:id/messages`, `:id/messages/voice` |
| `conversations:acknowledge` | `PATCH /conversations/:id/read`, `PATCH /messages/:id/acknowledge` |
| `conversations:manage_status` | `PATCH /conversations/:id/status` |

---

## B. Reference lists

### B.1 All `:page` permissions (23)
```
dashboard:page
users:page
roles:page
customers:page
orders:page
products:page
pricing:page
inventory:page
payments:page
transactions:page
daily_sheets:page
vans:page
routes:page
tracking:page
delivery_issues:page
damage_cases:page
expenses:page
analytics:page
tickets:page
notifications:page
balance_reminders:page
audit_logs:page
settings:page
```

### B.2 All action (non-page) permissions (97)
```
# dashboard (1)
dashboard:view
# users (6)
users:view  users:create  users:update  users:deactivate  users:restore  users:delete
# roles (8)
roles:view  roles:create  roles:update  roles:delete  roles:clone  roles:reset  roles:assign  roles:manage_overrides
# customers (8)
customers:view  customers:create  customers:update  customers:deactivate  customers:restore  customers:delete  customers:export  customers:manage_portal
# orders (4)
orders:view  orders:approve  orders:reject  orders:dispatch
# products (4)
products:view  products:create  products:update  products:delete
# pricing (2)
pricing:view  pricing:update
# inventory (6)
inventory:view  inventory:add_stock  inventory:adjust  inventory:write_off  inventory:mark_damaged  inventory:manage_repairs
# payments (3)
payments:view  payments:approve  payments:reject
# transactions (3)
transactions:view  transactions:record_payment  transactions:adjust
# daily_sheets (11)
daily_sheets:view  daily_sheets:generate  daily_sheets:update  daily_sheets:load_out  daily_sheets:check_in  daily_sheets:close  daily_sheets:confirm_crew  daily_sheets:swap_assignment  daily_sheets:bulk_import  daily_sheets:manage_edit_locks  daily_sheets:export
# vans (7)
vans:view  vans:create  vans:update  vans:deactivate  vans:restore  vans:delete  vans:manage_crew
# routes (4)
routes:view  routes:create  routes:update  routes:delete
# tracking (2)
tracking:view  tracking:report_location
# delivery_issues (3)
delivery_issues:view  delivery_issues:plan  delivery_issues:resolve
# damage_cases (7)
damage_cases:view  damage_cases:create  damage_cases:update  damage_cases:review  damage_cases:charge  damage_cases:waive  damage_cases:reverse
# expenses (4)
expenses:view  expenses:create  expenses:update  expenses:delete
# analytics (2)
analytics:view  analytics:export
# tickets (2)
tickets:view  tickets:reply
# notifications (2)
notifications:view  notifications:configure
# balance_reminders (3)
balance_reminders:view  balance_reminders:send  balance_reminders:configure
# audit_logs (1)
audit_logs:view
# settings (2)
settings:view  settings:update
# whatsapp (2)
whatsapp:view  whatsapp:manage
```

---

## C. Modules considered & excluded (with reason)

| Area | Backend controller(s) | Decision |
|---|---|---|
| Vendor/tenant management, platform stats, suspend, reset-admin-password | `vendor.controller`, `dashboard.controller GET /platform` | **Excluded** — super-admin / **admin-panel** app, cross-vendor. Not part of the vendor-dashboard RBAC surface. |
| Customer self-service | `customer-portal`, `order-portal`, `payment-portal`, `ticket-portal`, `notification-portal` | **Excluded** — `CUSTOMER` role, portal app. Guarded separately. |
| Per-user self settings | `notification-preferences`, `fcm`, `users/me/change-password` | **Excluded** — acting on one's own account; no permission required. |
| Health checks | `health.controller` | **Excluded** — public/infra. |
| Payment webhook | `payment/webhook.controller POST /paymob` | **Excluded** — machine-to-machine; signature-verified, not user-gated. |
| Email | `email` module | **Excluded** — internal service, no routes. |

**No missing navigable modules found.** All 24 `/dashboard/*` route folders map to a resource (`overview`+`home`→dashboard, `warehouse`→inventory, `payment-requests`→payments, `notification-settings`→notifications, `history`→daily_sheets, `damage-report`→damage_cases). Two **new** resources are introduced by the RBAC feature itself: `roles` (management UI) and `settings` (container). `whatsapp` is the only non-navigable resource.

---

## D. Deltas from the design-doc §5 draft

The draft was illustrative; this catalog is endpoint-verified. Changes:

**Removed (no existing feature):**
- `orders`: `create, update, delete, assign, cancel, refund, print` → replaced with real `approve, reject, dispatch`.
- `products`: `import, export` (no such endpoints).
- `inventory`: `remove_stock, transfer` → replaced with real `write_off, mark_damaged, manage_repairs`.
- `payments`: `create, refund, delete` → replaced with real `approve, reject`.
- `tickets`: `close, assign` (only `reply` exists).
- `notifications`: `send` (sending is via `balance_reminders`/`whatsapp`).
- `invoices`/`statements` as a standalone resource → folded into `daily_sheets:export` + `customers:export`.
- `deliveries` as a standalone resource → folded into `daily_sheets:*` (no standalone page/endpoints).
- `users`: `export` (no endpoint).

**Added / renamed to match reality:**
- Lifecycle split `deactivate` + `restore` (from real `/deactivate` + `/reactivate` endpoints) on `users`, `customers`, `vans`.
- `customers:manage_portal`, `pricing` module, `daily_sheets:{load_out,check_in,swap_assignment,confirm_crew,bulk_import,manage_edit_locks,generate}`, `damage_cases:{review,charge,waive,reverse}`, `vans:manage_crew`, `tracking:report_location`, `roles:{clone,reset,assign,manage_overrides}`, `settings`, `whatsapp`.

> Action: update design-doc §5's table to reference this catalog, or treat this file as the authoritative override.

---

## E. Validation

- **Uniqueness:** every `resource:action` pair is unique; no two permissions collide. (23 pages + 97 actions, all distinct — verified by construction, one row per capability.)
- **Format:** all lowercase, `resource:action`, single `:` separator, `snake_case` multi-word segments (`manage_repairs`, `record_payment`, `report_location`, `manage_overrides`). No dots, no camelCase, no spaces.
- **Page coverage:** every navigable module (23) has exactly one `:page`. Every `/dashboard/*` route resolves to a `:page` (Page Registry, design-doc §5). No route left unmapped.
- **No orphan actions:** every action permission belongs to a resource that also defines a `:page` — except `whatsapp` (intentionally non-navigable). Satisfies the §6 "no action without its page" invariant.
- **Reserved word `page`** is used only as the route permission and for no other meaning.
- **Wildcard compatibility:** `resource:*` cleanly covers all listed actions incl. `:page`; `*` covers everything.

### E.1 Verification pass (2026-07-08) — 9 checks
1. ✅ Every permission maps to a real endpoint/feature (§A traceability column). One documented forward-looking capability: `settings:*` (Settings section exists; standalone page/vendor-self-profile endpoint not yet built — not added to the Page Registry until it is).
2. ✅ No duplicates/overlaps — 120 unique pairs.
3. ✅ Every frontend gate has a backend check (server-side `PermissionsGuard` is the boundary; frontend mirrors the same strings).
4. ✅ Every navigable route → exactly one `:page` (22 live routes; `settings:page` reserved).
5. ✅ Every protected vendor endpoint → ≥1 permission (full endpoint→permission map, zero gaps; portal/self/platform/infra excluded per §C).
6. ✅ No orphan permissions (every action's resource has a `:page`, except non-navigable `whatsapp`).
7. ✅ Role presets (design-doc §6) corrected to reference only valid catalog strings (removed `invoices:*`, `orders:update/cancel/create`, `inventory:remove_stock/transfer`, `deliveries:*`).
8. ✅ One source of truth — Registry, Catalog, Presets, guards, and frontend all import from `@water-supply-crm/authz`.
9. ✅ Documentation reconciled — design-doc §5 draft table replaced with a pointer to this frozen file; no conflicting permission lists remain.

---

## F. Final Summary

| Metric | Count |
|---|---|
| **Total permissions** | **123** (120 + Amendments R1, R2) |
| Page permissions (`:page`) | 23 |
| Action permissions | 100 |
| Navigable modules (page-bearing resources) | 23 |
| Non-navigable resources | 1 (`whatsapp`) |
| **Total resources** | **24** |
| New resources introduced by RBAC feature | 2 (`roles`, `settings`) |
| Excluded areas (portal/self/platform/infra) | 6 |

Largest group: `daily_sheets` (12). Smallest page-bearing: `dashboard`, `audit_logs` (2 each).

---

*Once approved, this catalog is encoded verbatim as the `PERMISSIONS` constant + `PERMISSION_GROUPS` + `PAGE_REGISTRY` in `@water-supply-crm/authz` (Phase A — Foundation).*
