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
Status: IMPLEMENTED

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
Status: IMPLEMENTED

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
Status: IMPLEMENTED

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
Status: IMPLEMENTED

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
Status: IMPLEMENTED

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
Status: IMPLEMENTED

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
Status: IMPLEMENTED

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
Status: IMPLEMENTED

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

## API-009 - Delivery Issues Domain + Ops Workflow Endpoints
Status: IMPLEMENTED

Endpoint:
- `GET /delivery-issues`
- `GET /delivery-issues/:id`
- `PATCH /delivery-issues/:id/plan`
- `PATCH /delivery-issues/:id/resolve`

Request diff:
- New delivery issue workflow model decoupled from raw item status.
- `plan` request should support:
  - `nextAction` (`RETRY_SAME_DAY | RETRY_ON_DATE_TIME | MOVE_TO_NEXT_REGULAR_DAY | SELF_PICKUP | CANCEL_ONE_OFF | PERMANENT_STOP`)
  - `retryAt` (optional, required for explicit retry datetime)
  - `assignedToUserId` (optional)
  - `assignedVanId` (optional)
  - `assignedDriverId` (optional)
  - `notes` (optional)
- `resolve` request should support:
  - `resolution` (`DELIVERED | SELF_PICKUP_DONE | DROPPED | CANCELLED`)
  - `notes` (optional)

Response diff:
- Additive new resource:
  - issue identity
  - linked `dailySheetItemId`
  - workflow status (`OPEN | PLANNED | IN_RETRY | RESOLVED | DROPPED`)
  - ownership, due/aging fields, audit metadata

Affected pages:
- `/dashboard/daily-sheets/:id`
- `/dashboard/delivery-issues`

Backward compatibility:
- Yes. New endpoints/resource; existing sheet APIs remain valid.

Owner:
- Requester: Frontend planning (Codex)
- API steward: Backend owner

## API-010 - On-Demand Order Dispatch Planning
Status: IMPLEMENTED

Endpoint:
- `POST /orders/:id/dispatch-plan`
- `PATCH /orders/:id/dispatch-plan`
- `POST /orders/:id/dispatch-now`

Request diff:
- Add dispatch planning payload:
  - `targetDate`
  - `timeWindow` (optional)
  - `vanId` (optional)
  - `driverId` (optional)
  - `dispatchMode` (`INSERT_IN_OPEN_SHEET | QUEUE_FOR_GENERATION`)
  - `notes` (optional)

Response diff:
- Add dispatch object in order response:
  - `dispatchStatus` (`UNPLANNED | PLANNED | INSERTED_IN_SHEET | DELIVERED | FAILED | SELF_PICKUP_DONE | CANCELLED`)
  - `plannedAt`, `plannedBy`, `targetDate`, assignment refs

Affected pages:
- `/dashboard/orders`

Backward compatibility:
- Yes. Existing approval/reject endpoints unchanged; new planning endpoints are additive.

Owner:
- Requester: Frontend planning (Codex)
- API steward: Backend owner

## API-011 - Daily Sheet Item Source Linking for On-Demand Orders
Status: IMPLEMENTED

Endpoint:
- `POST /daily-sheets/:id/items/from-order`
- `GET /daily-sheets`
- `GET /daily-sheets/:id`

Request diff:
- Add manual insertion endpoint from approved/planned order into a sheet:
  - `orderId`
  - optional `sequenceMode` (`APPEND | CUSTOM`)
  - optional `sequence`

Response diff:
- In sheet list rows add additive counters:
  - `issueCount`
  - `onDemandCount`
- In sheet detail items add additive fields:
  - `sourceOrderId` (nullable)
  - `deliveryType` (`SCHEDULED | ON_DEMAND`)

Affected pages:
- `/dashboard/daily-sheets`
- `/dashboard/daily-sheets/:id`
- `/dashboard/orders`

Backward compatibility:
- Yes. Additive fields and new endpoint.

Owner:
- Requester: Frontend planning (Codex)
- API steward: Backend owner

## API-012 - Generation Pipeline Includes Planned On-Demand Orders
Status: IMPLEMENTED

Endpoint:
- `POST /daily-sheets/generate`

Request diff:
- No request shape change required.

Response diff:
- Generation must include approved + planned on-demand orders for target date with idempotency safeguards.
- Job result should include additive summary:
  - `insertedOnDemandCount`
  - `skippedOnDemand` (with reason list)

Affected pages:
- `/dashboard/daily-sheets`
- `/dashboard/orders`

Backward compatibility:
- Yes. Existing request works unchanged; generation behavior is enhanced.

Owner:
- Requester: Frontend planning (Codex)
- API steward: Backend owner

## API-013 - Ops Analytics for Issues and On-Demand Fulfillment
Status: IMPLEMENTED

Endpoint:
- `GET /analytics/deliveries` (extended)
- `GET /dashboard/overview` (extended optional KPIs)

Request diff:
- No request shape change required.

Response diff:
- Add additive KPI fields:
  - `openIssues`
  - `issueAgingBuckets`
  - `onDemandFulfillmentRate`
  - `retrySuccessRate`

Affected pages:
- `/dashboard/analytics`
- `/dashboard/overview` (optional KPI cards)

Backward compatibility:
- Yes. Additive fields only.

Owner:
- Requester: Frontend planning (Codex)
- API steward: Backend owner

## API-014 - Portal Transactions Server-Side Filters
Status: IMPLEMENTED

Endpoint:
- `GET /portal/transactions`

Request diff:
- Add optional query params:
  - `type` (`PAYMENT | DELIVERY | ADJUSTMENT`)
  - `dateFrom` (YYYY-MM-DD)
  - `dateTo` (YYYY-MM-DD)
  - `search` (optional text against description)

Response diff:
- No response shape change required.

Affected pages:
- `customer-portal` `/transactions`
- `customer-portal` `/home` (recent activity consistency)

Backward compatibility:
- Yes. Optional query params only.

Owner:
- Requester: Frontend planning (Codex)
- API steward: Backend owner

## API-015 - Portal Order Fulfillment Lifecycle Visibility
Status: IMPLEMENTED

Endpoint:
- `GET /portal/orders`
- `GET /portal/orders/:id` (optional new detail endpoint)

Request diff:
- Optional: add status filters for new lifecycle states.

Response diff:
- Extend order response with additive fields:
  - `fulfillmentStatus` (`PENDING_APPROVAL | APPROVED | PLANNED | OUT_FOR_DELIVERY | DELIVERED | REJECTED | CANCELLED`)
  - `plannedDate` (nullable)
  - `deliveredAt` (nullable)
  - `dispatchContext` (van/driver/sheet reference when available)

Affected pages:
- `customer-portal` `/orders`

Backward compatibility:
- Yes. Additive fields; existing status can remain for compatibility.

Owner:
- Requester: Frontend planning (Codex)
- API steward: Backend owner

## API-016 - Portal Tickets Conversation + Attachments
Status: IMPLEMENTED

Endpoint:
- `GET /portal/tickets/:id/messages` (new)
- `POST /portal/tickets/:id/messages` (new)

Request diff:
- Message payload:
  - `message` (string)
  - optional `attachments[]`

Response diff:
- Add conversation timeline resource:
  - `id`, `ticketId`, `senderRole`, `message`, `attachments[]`, `createdAt`

Affected pages:
- `customer-portal` `/support`

Backward compatibility:
- Yes. Existing ticket endpoints unchanged.

Owner:
- Requester: Frontend planning (Codex)
- API steward: Backend owner

## API-017 - Portal Products Effective Price Field
Status: IMPLEMENTED

Endpoint:
- `GET /portal/products`

Request diff:
- No request change required.

Response diff:
- Add additive field:
  - `effectivePrice` (custom price fallback to base price)

Affected pages:
- `customer-portal` `/orders`

Backward compatibility:
- Yes. Additive field only.

Owner:
- Requester: Frontend planning (Codex)
- API steward: Backend owner

## API-018 - Portal Notifications Feed (Future)
Status: IMPLEMENTED

Endpoint:
- `GET /portal/notifications`
- `PATCH /portal/notifications/:id/read`
- `PATCH /portal/notifications/read-all`

Request diff:
- Optional pagination + filter by `isRead`.

Response diff:
- Notification payload:
  - `id`, `type`, `title`, `message`, `entityId`, `isRead`, `createdAt`

Affected pages:
- `customer-portal` all pages (header bell)

Backward compatibility:
- Yes. New endpoint set only.

Owner:
- Requester: Frontend planning (Codex)
- API steward: Backend owner

## API-019 - Notification Delivery Log + Admin Query Endpoints
Status: IMPLEMENTED

Endpoint:
- `GET /notifications/logs`
- `GET /notifications/logs/:id`

Request diff:
- Add optional filters:
  - `eventType`
  - `channel` (`WHATSAPP | FCM | SMS | IN_APP`)
  - `status` (`QUEUED | SENT | FAILED`)
  - `dateFrom`
  - `dateTo`
  - `recipientType` (`CUSTOMER | USER`)
  - `recipientId`

Response diff:
- New delivery log resource:
  - `id`, `eventType`, `channel`, `status`
  - `recipientType`, `recipientId`, `recipientAddress`
  - `entityType`, `entityId`
  - `attemptCount`, `lastError`
  - `queuedAt`, `sentAt`, `failedAt`

Affected pages:
- Vendor dashboard notification operations (future)
- Admin panel observability (future)

Backward compatibility:
- Yes. Additive new endpoints.

Owner:
- Requester: Frontend planning (Codex)
- API steward: Backend owner

## API-020 - Notification Preferences Endpoints
Status: PROPOSED

Endpoint:
- `GET /notifications/preferences`
- `PATCH /notifications/preferences`

Request diff:
- Preference payload by event type and channel:
  - `eventType`
  - `channel`
  - `enabled` (boolean)

Response diff:
- Preference list/resource:
  - `id`, `eventType`, `channel`, `enabled`, `updatedAt`

Affected pages:
- Customer portal profile/preferences (future)
- Vendor dashboard user settings (future)

Backward compatibility:
- Yes. New endpoints only.

Owner:
- Requester: Frontend planning (Codex)
- API steward: Backend owner
