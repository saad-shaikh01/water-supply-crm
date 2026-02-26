# API Change Cards

Last Updated: February 26, 2026
Purpose: Controlled backend adjustments required by frontend work.

## Card Template

```md
## API-XXX - <Short Title>
Status: PROPOSED | APPROVED | IMPLEMENTED | REJECTED

Endpoint:
- Method + path

Request diff:
- ...

Response diff:
- ...

Affected pages:
- app route list

Backward compatibility:
- Yes/No and migration notes

Owner:
- Requester
- API steward
```

## Active Cards

## API-001 - Customers List Filter by Delivery Day and Van
Status: PROPOSED

Endpoint:
- `GET /customers`

Request diff:
- Add optional query param: `dayOfWeek` (integer `1..6`)
- Add optional query param: `vanId` (UUID)
- Semantics:
  - `dayOfWeek`: return customers with at least one `deliverySchedule.dayOfWeek = dayOfWeek`
  - `vanId`: return customers with at least one `deliverySchedule.vanId = vanId`
  - If both provided, apply both constraints (AND behavior on schedule match)

Response diff:
- No response shape change required.

Affected pages:
- `/dashboard/customers`

Backward compatibility:
- Yes. Both params are optional; existing clients continue to work unchanged.

Owner:
- Requester: Frontend planning (Codex)
- API steward: Backend owner

## API-002 - Daily Sheets List Operational Aggregates
Status: PROPOSED

Endpoint:
- `GET /daily-sheets`

Request diff:
- No request change required.

Response diff:
- Add additive fields per sheet row:
  - `itemCounts`: `{ pending: number, completed: number, issues: number }`
  - `tripState`: `{ tripCount: number, hasActiveTrip: boolean }`
- Keep existing fields unchanged.

Affected pages:
- `/dashboard/daily-sheets`

Backward compatibility:
- Yes. Additive response fields only.

Owner:
- Requester: Frontend planning (Codex)
- API steward: Backend owner

## API-003 - Daily Sheet Detail Wallet Product Mapping
Status: PROPOSED

Endpoint:
- `GET /daily-sheets/:id`

Request diff:
- No request change required.

Response diff:
- In `items[].customer.wallets[]`, include `productId` in addition to existing `balance` and `product`.
- Purpose: map wallet to current delivery item product deterministically.

Affected pages:
- `/dashboard/daily-sheets/:id`

Backward compatibility:
- Yes. Additive response field only.

Owner:
- Requester: Frontend planning (Codex)
- API steward: Backend owner

## API-004 - Products Delete Endpoint Contract
Status: PROPOSED

Endpoint:
- `DELETE /products/:id`

Request diff:
- No request body change.

Response diff:
- Add delete response shape: `{ deleted: true }`
- Return clear conflict error when deletion is not allowed due to dependent records.

Affected pages:
- `/dashboard/products`

Backward compatibility:
- Yes. Additive endpoint; existing clients unaffected.

Owner:
- Requester: Frontend planning (Codex)
- API steward: Backend owner

## API-005 - Routes List Filters (Search + Default Van)
Status: PROPOSED

Endpoint:
- `GET /routes`

Request diff:
- Add optional query param: `search` (string, route name contains)
- Add optional query param: `defaultVanId` (UUID)
- Keep existing `page`/`limit` behavior.

Response diff:
- No response shape change required.

Affected pages:
- `/dashboard/routes`

Backward compatibility:
- Yes. Optional query params only.

Owner:
- Requester: Frontend planning (Codex)
- API steward: Backend owner

## API-006 - Orders and Tickets STAFF Access Alignment
Status: PROPOSED

Endpoint:
- `GET /orders`, `PATCH /orders/:id/approve`, `PATCH /orders/:id/reject`
- `GET /tickets`, `PATCH /tickets/:id/reply`

Request diff:
- No request shape change.

Response diff:
- No response shape change.

Access policy diff:
- Add `STAFF` role access for above endpoints to match dashboard navigation intent.

Affected pages:
- `/dashboard/orders`
- `/dashboard/tickets`

Backward compatibility:
- Yes for clients; security scope expands, so explicit owner approval required.

Owner:
- Requester: Frontend planning (Codex)
- API steward: Backend owner

## API-007 - Orders List Advanced Filters
Status: PROPOSED

Endpoint:
- `GET /orders`

Request diff:
- Add optional query params:
  - `search` (customer name/phone or product name contains)
  - `customerId` (cuid/string)
  - `productId` (UUID/cuid based on model id format)
  - `dateFrom` (YYYY-MM-DD)
  - `dateTo` (YYYY-MM-DD)

Response diff:
- No response shape change required.

Affected pages:
- `/dashboard/orders`

Backward compatibility:
- Yes. Optional query params only.

Owner:
- Requester: Frontend planning (Codex)
- API steward: Backend owner

## API-008 - Tickets List Advanced Filters
Status: PROPOSED

Endpoint:
- `GET /tickets`

Request diff:
- Add optional query params:
  - `priority` (`LOW | NORMAL | HIGH | URGENT`)
  - `search` (subject/description/customer name contains)
  - `dateFrom` (YYYY-MM-DD)
  - `dateTo` (YYYY-MM-DD)

Response diff:
- No response shape change required.

Affected pages:
- `/dashboard/tickets`

Backward compatibility:
- Yes. Optional query params only.

Owner:
- Requester: Frontend planning (Codex)
- API steward: Backend owner
