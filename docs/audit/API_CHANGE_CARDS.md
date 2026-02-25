# API Change Cards

Last Updated: February 25, 2026
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
