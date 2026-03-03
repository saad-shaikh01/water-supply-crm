## Scope

This board tracks frontend work needed to make:

- Vendor Balance Reminders UX production-ready
- Vendor Transactions screen production-ready

Backend work is tracked separately in:

- `docs/audit/BALANCE_REMINDERS_TRANSACTIONS_BACKEND_TASK_BOARD.md`

## Current Frontend Reality

- Balance Reminders page exists, but it currently depends on a broken API contract and only supports schedule config + bulk send-now.
- There is no targeted customer reminder UX.
- Transactions page has basic filters only (`type`, `dateFrom`, `dateTo`).
- Transactions page does not expose `vanId`, `customerId`, real search, or a useful finance summary strip.

## Delivery Order

1. Fix current broken balance-reminder page contract
2. Add targeted reminder UX and activity visibility
3. Upgrade transactions filters
4. Add finance summary + better row context

## Tickets

| Ticket ID | Feature | Priority | Status | Description | Depends On |
|---|---|---|---|---|---|
| BR-FE-001 | Balance Reminders | High | DONE | Fix current page contract to use backend's real shape: `scheduled`, `cronExpression`, `nextRunAt`, `minBalance`. Remove false inactive state caused by mismatched field names. | BR-BE-001 |
| BR-FE-002 | Balance Reminders | High | DONE | Fix preset UX to respect PKT-facing labels while sending correct UTC cron expressions. Do not show "Daily at 9 AM" while posting the wrong cron value. | BR-BE-001 |
| BR-FE-003 | Balance Reminders | Medium | READY | Add a dry-run preview panel that shows exactly which customers would receive reminders before sending. | BR-BE-006 |
| BR-FE-004 | Balance Reminders | High | READY | Add targeted single-customer send flow: searchable customer picker + confirmation modal + send action. | BR-BE-005 |
| BR-FE-005 | Balance Reminders | Medium | READY | Add selected-customer bulk send flow for multiple chosen customers without sending to the full eligible customer base. | BR-BE-005 |
| BR-FE-006 | Balance Reminders | Medium | READY | Add recent reminder activity table showing recent runs and per-run counts. | BR-BE-003 |
| BR-FE-007 | Balance Reminders | Medium | READY | Add per-recipient result details for manual send actions (sent, skipped, failed, reason). | BR-BE-004 |
| BR-FE-008 | Balance Reminders | Medium | READY | Add customer-specific reminder entry points from customer list and customer detail screens. The dedicated balance-reminders page should not be the only place to trigger a reminder. | BR-BE-005 |
| BR-FE-009 | Balance Reminders | Low | READY | Add safe empty states and warning states: WhatsApp disabled, no eligible customers, no schedule configured, cooldown prevented send. | BR-BE-007 |
| TX-FE-001 | Transactions | High | DONE | Add `vanId` filter to the vendor transactions screen and wire it to URL state. Backend support already exists. | - |
| TX-FE-002 | Transactions | High | DONE | Add `customerId` filter to the vendor transactions screen and wire it to URL state. This should be usable on the global transactions page, not only customer detail context. | - |
| TX-FE-003 | Transactions | High | DONE | Replace the current minimal filter row with a compact filter pattern: search + one primary filter inline, secondary controls behind a Filters drawer, active chips, clear-all. | TX-FE-001 |
| TX-FE-004 | Transactions | High | READY | Add `search` UI and wire it to the backend once `search` support exists. Preserve URL state and debounce input. | TX-BE-001 |
| TX-FE-005 | Transactions | Medium | DONE | Add quick date presets (`Today`, `Last 7 Days`, `This Month`) alongside custom range input. | - |
| TX-FE-006 | Transactions | Medium | READY | Add a summary strip above the transactions table: total charges, total collections, net adjustments, total rows for current filter set. | TX-BE-004 |
| TX-FE-007 | Transactions | Medium | READY | Add richer table context columns: customer code, van/route reference, source/reference link where available. | TX-BE-005 |
| TX-FE-008 | Transactions | Medium | READY | Add row drill-through behavior so finance users can jump to customer, payment request, or source record from the ledger. | TX-BE-005 |
| TX-FE-009 | Transactions | Medium | READY | Improve mobile behavior specifically for the transaction filters and summary strip so the table starts higher and the filter area does not dominate screen height. | TX-FE-003 |

## UX Constraints

### Balance Reminders

- Manual send must be explicit and safe.
- Use confirmation before bulk send.
- Show whether the action is:
  - dry run
  - real send
  - single customer
  - selected customers
  - all eligible customers

### Transactions

- Finance users should be able to answer:
  - what came in today?
  - which van collected this?
  - who still needs review?
  - where did this number come from?

- The screen should not feel like a raw ledger dump.

## Acceptance Standard

A frontend ticket is only considered DONE when:

- URL state is stable
- empty/loading/error states are explicit
- mobile layout is still usable
- filter behavior is consistent with existing vendor list-page patterns
- no hidden dependency on manual page refresh exists

## Product Notes

- Balance reminders should be treated as an operations tool, not only a settings page.
- Transactions should behave like a finance workspace, not just a historical table.
