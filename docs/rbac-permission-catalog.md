# RBAC — Finalized Permission Catalog (Vendor Dashboard)

**Status:** 🧊 **FROZEN (2026-07-08)** — the single source of truth for backend, frontend, middleware, guards, seeders, and the permission-management UI. Passed the 9-point verification pass. **Permission names must not change without explicit owner approval.**
**Date:** 2026-07-08

> **Amendment R1 (Phase C, owner-approved 2026-07-08):** added **`customers:view_financial`** (financial-summary + consumption views, separate from operational `customers:view`) and **`customers:update_location`** (GPS pinning, separate from general `customers:update`). This separates operational from financial customer viewing, and location updates from general editing, so drivers are not broadened to sensitive data.
> **Amendment R2 (Phase C / Batch 16, owner-approved 2026-07-08):** added **`daily_sheets:correct`** (admin-only financial correction entry, separate from `daily_sheets:update`) to preserve the `VENDOR_ADMIN`-only boundary on sheet corrections. **Totals updated: 123 permissions, 100 actions.**
> **Amendment R3 (Payroll Phase 1, owner-approved 2026-08-06):** added the new **`payroll`** resource (non-navigable — no `/dashboard/payroll` route yet), 11 actions covering the Staff Financial Ledger module: `view_all`, `ledger_create`, `ledger_approve`, `ledger_void`, `ledger_reverse`, `ledger_correct`, `salary_structure_manage`, `period_generate`, `entry_approve`, `period_lock`, `period_unlock`. `payroll:view_all` is deliberately granted to **no** default preset (override-only via `UserPermissionOverride`) per this row's distinct wording in `docs/features/staff-payroll-financial-management.md` §10 ("VENDOR_ADMIN, STAFF *(if given the permission)*" — read as override-only, unlike every other row's flat grant). A `payroll:approval_rules_manage` action and its backing CRUD endpoint were drafted alongside this work and **rejected**: no such management surface is specified anywhere in the approved planning doc, and the draft's own code comments misattributed a quote to §10 that does not exist there.

> **Amendment R4 (Payroll Phase 1, owner-approved 2026-08-06):** added **`payroll:settlement_record`** to the `payroll` resource, gating `POST /payroll/entries/:id/settlements` (and `PATCH /payroll/entries/:id/mark-settled`) — recording a full or partial payment against a locked `PayrollEntry`. Granted to `VENDOR_ADMIN` + `STAFF` by default (a flat grant, like `ledger_create`/`salary_structure_manage`/`period_generate` above, **not** override-only like `view_all`), per `docs/features/staff-payroll-financial-management.md` §10 ("Record settlement (mark paid): VENDOR_ADMIN, STAFF").

> **Amendment R5 (Crew Cash Phase 3, owner-approved 2026-08-07):** added the new **`crew_cash`** resource (non-navigable — recorded from a card on the existing Daily Sheet detail page, no dedicated route), 5 actions covering the Crew Cash Distribution extension to Payroll: `create`, `edit`, `delete`, `approve`, `view_all`. Default holders per `docs/features/crew-operational-cash-distribution.md` §11: `create` → `SALESMAN` (primary user today), `DRIVER`, `STAFF`, `VENDOR_ADMIN`; `edit`/`delete` → the entry's own creator (code-level check, not RBAC) OR `STAFF`/`VENDOR_ADMIN`; `approve` → `STAFF`, `VENDOR_ADMIN`; `view_all` → `STAFF`, `VENDOR_ADMIN` (self-view as recipient needs no permission — implicit, matching the `payroll:view_all` pattern). Unlike `payroll:view_all` (Amendment R3, override-only, granted to no default preset), `crew_cash:view_all` **is** a flat `STAFF`/`VENDOR_ADMIN` default — §11's table words every row the same flat way, with none of the distinctly-worded override-only phrasing that applies to `payroll:view_all`. **Totals updated: 149 permissions, 28 resources.**

> **Amendment R6 (Payroll Phase 4-1, owner-approved 2026-08-08):** added **`payroll:page`** to the `payroll` resource and flipped `payroll.navigable` to `true` — the vendor-dashboard `/dashboard/payroll` module (Payroll Dashboard, Employees list, Employee Financial Profile, and the Log Ledger Entry dialog) now exists, resolving the "future frontend phase adds `payroll:page`" note from Amendment R3. Sorted first in `payroll`'s action list per the "`page` sorts first" convention every other navigable resource already follows. Granted to `VENDOR_ADMIN` (wildcard) and `STAFF`/Manager (added to `MANAGER_PERMISSIONS` in `presets.ts` alongside the other flat-default payroll grants — `ledger_create`, `salary_structure_manage`, `period_generate`, `settlement_record`); the read-only `viewer` preset also inherits it automatically (every `:page` permission is a flat viewer default). `payroll` is removed from the "no action without its `:page`" exemption list in `permissions.spec.ts`/`engine.spec.ts` (only `whatsapp` and `crew_cash` remain exempt, both still genuinely routeless). **Totals updated: 150 permissions, 28 resources.**
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

### 27. Payroll — `payroll` *(navigable since Amendment R6 — `/dashboard/payroll`, its `Employees` list, and each employee's Financial Profile)*
> Viewing one's OWN payroll/ledger records needs no permission at all — enforced in code (compare the requester's `userId` to the record's owner), not RBAC, since every role must be able to see its own pay. `payroll:view_all` is only for seeing OTHER employees' records, and is override-only (see Amendment R3 above — no default preset grants it).

| Permission | Gates |
|---|---|
| `payroll:page` | Opens `/dashboard/payroll` and every sub-route under it (Page Registry longest-prefix match) — the Payroll Dashboard, Employees list, and Employee Financial Profile |
| `payroll:view_all` | View any employee's payroll/ledger (self-view needs no permission, see above) — `GET /payroll/periods/:periodId/entries`; self-scope check inside `GET /payroll/ledger-entries/employee/:userId`, `GET /payroll/salary-structures/employee/:userId(/effective)`, `GET /payroll/entries/:id/breakdown` |
| `payroll:ledger_create` | `POST /payroll/ledger-entries` |
| `payroll:ledger_approve` | `PATCH /payroll/ledger-entries/:id/approve` |
| `payroll:ledger_void` | `PATCH /payroll/ledger-entries/:id/void` (creator may also void their own entry without this permission) |
| `payroll:ledger_reverse` | `POST /payroll/ledger-entries/:id/reverse` |
| `payroll:ledger_correct` | `POST /payroll/ledger-entries/:id/correct` |
| `payroll:salary_structure_manage` | `POST /payroll/salary-structures` |
| `payroll:period_generate` | `POST /payroll/periods/open`, `POST /payroll/periods/:periodId/entries/generate` |
| `payroll:entry_approve` | `PATCH /payroll/entries/:id/approve` |
| `payroll:period_lock` | `PATCH /payroll/periods/:id/lock` |
| `payroll:period_unlock` | `PATCH /payroll/periods/:id/unlock` |
| `payroll:settlement_record` | `POST /payroll/entries/:id/settlements` |

### 28. Crew Cash Distribution — `crew_cash` *(NON-navigable — recorded from a card on the existing Daily Sheet detail page, no dedicated route)*
> Viewing one's OWN Crew Cash Distribution history (as the recipient `employeeId`) needs no permission at all — enforced in code (compare the requester's `userId` to the record's `employeeId`), same pattern as `payroll:view_all` above. `crew_cash:view_all` is only for seeing OTHER employees' entries, and — unlike `payroll:view_all` — **is** a flat `STAFF`/`VENDOR_ADMIN` default (see Amendment R5 above). `edit`/`delete` are additionally allowed for the entry's own creator (`createdById`) as a code-level check even without the permission, mirroring `payroll:ledger_void`'s "creator OR permission" precedent.

| Permission | Gates |
|---|---|
| `crew_cash:create` | `POST /daily-sheets/:dailySheetId/crew-cash` |
| `crew_cash:edit` | `PATCH /crew-cash/:id` (creator may also edit their own entry without this permission) |
| `crew_cash:delete` | `DELETE /crew-cash/:id` (creator may also delete their own entry without this permission) |
| `crew_cash:approve` | `PATCH /crew-cash/:id/approve` |
| `crew_cash:view_all` | View any employee's Crew Cash Distribution history (self-view needs no permission, see above) — self-scope check inside `GET /crew-cash/employee/:employeeId` |

> `GET /daily-sheets/:dailySheetId/crew-cash` (the sheet-scoped list, feeding the Daily Sheet detail card) carries no dedicated permission — `@AuthenticatedOnly()`, tenancy-scoped by `vendorId` in the service, same as the sheet's own Expense list — access to the sheet itself is already gated by `daily_sheets:view` at the page level.

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
# collection_policy action (1)
collection_policy:update
# conversations action (5)
conversations:create  conversations:send  conversations:acknowledge  conversations:manage_status
# payroll (12, all non-page — resource has no :page yet)
payroll:view_all  payroll:ledger_create  payroll:ledger_approve  payroll:ledger_void  payroll:ledger_reverse  payroll:ledger_correct  payroll:salary_structure_manage  payroll:period_generate  payroll:entry_approve  payroll:period_lock  payroll:period_unlock  payroll:settlement_record
```

> **Note:** the `B.2` count in its heading (97) and §E/§F totals predate the `collection_policy`/`conversations` (2026-07-16) and `payroll` (2026-08-06, Amendment R3) additions in §A above — §A is kept current on every catalog change; §E/§F have accumulated drift from earlier additions and are not repaired here (pre-existing, out of this change's scope).

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
