## Scope

This board tracks backend work needed to make:

- Balance Reminders production-ready
- Vendor Transactions screen production-ready

It intentionally excludes broad UI polish. Frontend work is tracked separately in:

- `docs/audit/BALANCE_REMINDERS_TRANSACTIONS_FRONTEND_TASK_BOARD.md`

## Current Backend Reality

- Balance reminders exist, but the current schedule contract is not durable enough for production.
- Manual send supports bulk threshold sends only; targeted customer send does not exist.
- Reminder execution is synchronous and not fully auditable.
- Transactions API already supports `customerId`, `vanId`, `type`, `dateFrom`, `dateTo`.
- Transactions API does not yet support a real `search` experience or richer finance filtering.

## Delivery Order

1. Fix existing balance-reminder contract and persistence
2. Add reminder logs and targeted-send capability
3. Expand transaction query capability
4. Add transaction summary/snapshot support
5. Add communications hardening where required

## Tickets

| Ticket ID | Feature | Priority | Status | Description | Depends On |
|---|---|---|---|---|---|
| BR-BE-001 | Balance Reminders | High | READY | Fix current schedule contract mismatch and normalize API shape. Standardize on `cronExpression`, `scheduled`, `nextRunAt`, `minBalance`, and return a stable response that the frontend can rely on. | - |
| BR-BE-002 | Balance Reminders | High | READY | Persist reminder schedule config in the database instead of relying only on BullMQ repeat metadata. Add a vendor-level config record as the source of truth for schedule state. | BR-BE-001 |
| BR-BE-003 | Balance Reminders | High | READY | Add reminder run logging. Track each reminder run (`scheduled`, `manual bulk`, `manual single`, `dry run`) with counts, status, and timestamps. | BR-BE-002 |
| BR-BE-004 | Balance Reminders | High | READY | Add per-recipient audit logging for reminder delivery: recipient, balance at send time, channel, status, failure reason, run reference. | BR-BE-003 |
| BR-BE-005 | Balance Reminders | High | READY | Add targeted send API for one customer or selected customers. Support payload modes like `single`, `selected`, and `eligible`. | BR-BE-002 |
| BR-BE-006 | Balance Reminders | Medium | READY | Add dry-run preview for targeted and bulk sends. Response should clearly show who would receive a reminder and why others are skipped. | BR-BE-005 |
| BR-BE-007 | Balance Reminders | High | READY | Move reminder delivery to queue-based execution per recipient instead of synchronous request-loop sending. Keep request latency low and improve retry behavior. | BR-BE-003 |
| BR-BE-008 | Balance Reminders | Medium | READY | Add cooldown protection to prevent repeated reminders to the same customer inside a defined window unless explicitly forced. | BR-BE-004 |
| BR-BE-009 | Balance Reminders | Medium | READY | Add reminder eligibility rules service: active customer only, positive balance threshold, valid phone, channel enabled, not opted out. Centralize this logic for dry-run + send-now + scheduled runs. | BR-BE-005 |
| BR-BE-010 | Balance Reminders | Medium | READY | Add optional multi-channel abstraction for reminders so the flow can support WhatsApp first, and later FCM/in-app without rewriting the module. | BR-BE-007 |
| TX-BE-001 | Transactions | High | READY | Expand `GET /transactions` to support `search` across customer name, customer code, and description. Keep pagination server-side. | - |
| TX-BE-002 | Transactions | Medium | READY | Add amount-range filters to `GET /transactions` (`amountMin`, `amountMax`) for finance reconciliation and exception review. | TX-BE-001 |
| TX-BE-003 | Transactions | Medium | READY | Add transaction source filter support (for example: `DELIVERY`, `MANUAL_PAYMENT`, `PAYMENT_REQUEST`, `ADJUSTMENT`) so finance users can narrow ledger views by source path. | TX-BE-001 |
| TX-BE-004 | Transactions | Medium | READY | Add a transaction summary endpoint for the active filter window: total charges, total collections, net adjustments, count. This should power a summary strip above the table. | TX-BE-001 |
| TX-BE-005 | Transactions | Medium | READY | Add richer related context to transaction list payload where useful: customer code, van/route linkage, payment-request reference, daily-sheet reference. Avoid excessive overfetching. | TX-BE-001 |
| TX-BE-006 | Transactions | Low | READY | Define sane default range behavior when no filters are provided (for example, current month or last 30 days) if product decision is approved. This avoids unbounded history queries in production. | TX-BE-004 |
| TX-BE-007 | Transactions | Medium | READY | Add CSV-ready export endpoint only if frontend-only export becomes insufficient at higher data volume. Keep as deferred unless required after usage validation. | TX-BE-004 |

## Ticket Notes

### BR-BE-001

- Current frontend sends `cron`; backend DTO expects `cronExpression`.
- Current frontend checks `existing.cron`; backend returns `cronExpression`.
- This mismatch must be fixed before any higher-level reminder UX work.

### BR-BE-002

- Queue metadata should not be the only source of truth.
- The schedule must survive worker restarts and remain introspectable.

### BR-BE-005

- Suggested request shape:

```json
{
  "mode": "single",
  "customerIds": ["customer-id"],
  "minBalance": 100,
  "dryRun": false,
  "force": false
}
```

### TX-BE-001

- `search` should be explicit and indexed where practical.
- Avoid turning the list into an expensive unbounded text scan.

## Acceptance Standard

A backend ticket is only considered DONE when:

- API contract is stable and documented in code
- validation DTOs are updated
- dependent service logic is covered
- rate limiting / retries are considered where relevant
- feature does not rely on implicit environment assumptions

## Operational Dependencies

- Balance reminders rely on the WhatsApp path today.
- If `WHATSAPP_ENABLED` is not configured to `true`, reminders will effectively no-op at delivery time.
- Password-reset email is a separate auth/email concern and not a blocker for these tickets, but email availability should be treated as a production readiness dependency.
