# Vendor Transaction-History Import - Design (1 page)

Extends `vendor-data-import-design.md` (sections 12 and 16). New entity `TRANSACTION_HISTORY` on the same pipeline: parse, map, validate, plan (plan-hash), queued execute, resume, history, revert, tenancy, RBAC `data_imports` (no new permission).

## Scope
- Source: `Tran_Data.html` (headerless, Windows-1252, one `<TR>` per voucher, customer code as HTML numeric entities) or Excel/CSV with the same fields: `customerCode, voucher, date, filled, empty, bottleBalanceAfter, charge, paid, outstandingAfter`.
- Ledger-only. NO DailySheet / DailySheetItem. Cash Ledger reads DailySheet + manual entries, never `Transaction`, so it cannot be touched.
- Customers already exist. History NEVER changes `financialBalance` / `BottleWallet.balance` (EXPLAIN mode only).
- Matching by `customerCode` only; unknown code -> row skipped, listed in the plan summary and the report.

## Posting (new path, `LedgerService` untouched)
Per voucher: charge row if `charge != 0` or bottles moved (`amount=charge`, `filledDropped`, `emptyReceived`, `bottleCount=filled-empty`), payment row if `paid != 0` (`amount=-paid`). Description is generated ("Delivered 3, Received 2" / "Payment received"); the file's own text is never stored. `createdAt` = voucher date 12:00 PKT + file-order offset (seconds). Balance-only vouchers (no movement) post nothing but still take part in reconciliation.

## reportingMode (batch option, default STATEMENT_ONLY)
1. `STATEMENT_ONLY`: `TransactionType.HISTORICAL`. Every revenue consumer filters by type, so P&L / dashboard / analytics ignore it; statements and the month-opening maths sum `amount` over all types, so they stay correct.
2. `COUNT_IN_REPORTS`: normal `DELIVERY` / `PAYMENT`. Requires an explicit acknowledgement and a cutover before the current month. Consumer audit below.

## Consumer audit (read-only check, 2026-10-08)
- (a) Sheet-item flows (void/edit delivery, closed-sheet edit, repricing, customer move) key off `dailySheetItemId`; history rows have none, so they are never selected. `editPayment` / `deletePayment` WOULD accept an imported standalone PAYMENT (COUNT mode) and move the balance: guarded in `TransactionController` via `ImportRow` lookup (LedgerService unchanged).
- (b) Type whitelists/blacklists: only `customer.service` wallet-at-period-end (`DELIVERY, ADJUSTMENT`), the statement PDFs (`!== 'DELIVERY'` goes to the "other" table - gets a `HISTORICAL` label). No raw SQL over `Transaction`.
- (c) Month-opening maths (`financialBalance - sum(amount from month start)`) is amount-based: correct in both modes. Balance reminders split payments by type: HISTORICAL payments in the reminder window would read as "not payments" - hence a wizard WARNING when the cutover is in the last 2 months. `lastPayment` (PAYMENT type) ignores HISTORICAL by design.
- (d) No job recomputes `financialBalance` from `sum(Transaction)`.
- (e) FE labels: transactions list, portal list, statement PDF get `HISTORICAL`.
- COUNT mode is asymmetric by nature of the existing code: P&L "Sale" and date-filtered analytics select DELIVERY by `dailySheet.date` (history has no sheet), "Amount Received" selects PAYMENT by `createdAt`. So old months show Received but no Sale. The wizard warning says so. Daily-sheet export of a past day lists history payments as "standalone payments".

## Reconciliation (per customer, all-or-nothing chain)
Expected balance at cutover = `financialBalance - sum(amount of existing Transaction rows after cutover day)`; wallet likewise with `bottleCount`. The last voucher's `outstandingAfter` / `bottleBalanceAfter` must equal it (paise / whole bottles) -> else ALL rows of that customer are skipped with `BALANCE_MISMATCH` (expected vs file). Row ERRORs (bad number/date) also block that customer's chain (`CHAIN_BLOCKED`); rows after cutover/future are ERROR but do NOT block (they are simply outside the chain). Without the after-columns: WARNING with the implied pre-history balance, nothing blocked. Chain breaks inside a customer (prev after + charge - paid != after) are a WARNING (first break per customer).

## Idempotency
`ImportRow.dedupeKey = sha256(vendor|code|voucher|date|filled|empty|charge|paid)` (+ ordinal when the voucher is blank). Compared only to `ImportRow`s with `result=CREATED` of this vendor, at plan time and again inside the execute transaction. Identical key twice inside one file (voucher present) -> second is `DUPLICATE_IN_FILE` skip.

## Execute / scale
Plan stage runs as a BullMQ job (`import.plan`, batch status `PLANNING`, progress in `summary.planning`); plan results written with bulk SQL. Execute: one DB transaction per customer (all vouchers, `createMany`), Resume at customer level, same claim/heartbeat/lock as customers import. Limits 25 MB / 100k rows, env-overridable.

## Revert
Batch-level: delete the Transaction ids recorded in each ImportRow's `appliedSnapshot`; balances never touched; a row whose transactions are gone is `REVERT_SKIPPED`. Works in both modes.

## Schema (additive)
`TransactionType.HISTORICAL`, `ImportEntity.TRANSACTION_HISTORY`, `ImportBatchStatus.PLANNING`, `ImportRow.dedupeKey` (+ index). No column on `Transaction`.

## Deviation to flag
The request asked to fill `financialBalanceAfter` / `bottleBalanceAfter` on each posted row; `Transaction` has no such columns (they live on `DailySheetItem`). Adding them would put two new columns on the hot, portal-exposed table, which the request itself rules out. The after-values are kept on `ImportRow.normalized` / `appliedSnapshot`; the statement derives its running balance from amounts. Adding two nullable columns later is a small follow-up if the statement should show a bottle-balance column for history rows.

## As built / verified (2026-10-09)
- Real `Tran_Data.html` (55,126 vouchers, 1,062 customers, 29.7 MB) on a throwaway Postgres + Redis + S3 stub + real Chrome: all 1,062 customers reconcile, 52,318 charge + 18,293 payment rows = 70,611 `HISTORICAL` transactions, `financialBalance` / wallets bit-for-bit unchanged, no sheet/item rows, P&L / analytics / dashboard revenue = 0 over the whole span.
- Throughput: upload+parse+insert ~12 s, plan job ~9 s, execute ~79 s (~700 vouchers/s), crash at 15k rows then Resume ~57 s with zero duplicates, revert ~118 s (preview 4 s).
- File cap is **50 MB** (not 25): the real export is 28.3 MB of per-cell markup. Env `IMPORT_HISTORY_MAX_FILE_BYTES` / `IMPORT_HISTORY_MAX_ROWS`.
- Statement PDF: history CHARGE rows (type HISTORICAL with bottle counts) render in the Delivery History table; history payments stay under "Other Transactions" typed "History". Wallet-at-period-end (`customer.service`) now includes HISTORICAL.
- Known gaps: the statement's "BAL BTL" column is blank for history rows (needs the two optional `Transaction` columns discussed above); reports mode: P&L "Sale" and date-filtered analytics ignore sheet-less deliveries; the daily-sheet export of a past day lists imported payments as standalone payments; customer consumption analytics (type DELIVERY) and `lastPayment` ignore HISTORICAL rows.
