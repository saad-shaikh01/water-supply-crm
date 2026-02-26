# Customer Portal Task Board

Last Updated: February 26, 2026
App: `apps/customer-portal`
Primary Owner: Agent C

## Status Legend

- `READY`: Can start immediately (frontend only)
- `BLOCKED`: Needs backend/API card completion first
- `DONE`: Merged into integration branch

## Closure Sprint (Must-Have)

| ID | Route / Module | Type | Task | Priority | Owner | Status | Depends On | Acceptance |
|---|---|---|---|---|---|---|---|---|
| CP-001 | Navigation (Header + MobileNav) | UX Bug | Add discoverable access for `/schedule` and `/statement` (desktop + mobile). | High | Agent C | DONE | - | User can reach both pages within max 2 taps from any portal page. |
| CP-002 | Mobile Navigation IA | UX Improvement | Replace crowded 7-item bottom nav with compact IA (primary tabs + `More` sheet). | High | Agent C | DONE | - | Bottom nav remains clear on 360px width; all routes still accessible. |
| CP-003 | Payments (`payment-dialog.tsx`) | Flow Bug | Integrate `usePaymentStatus` for Raast flow (pending/processing/paid/expired/rejected states). | High | Agent C | DONE | - | After QR initiation, dialog reflects real status and refreshes payment list on terminal state. |
| CP-004 | Payments (`payment-dialog.tsx`) | Feature Gap | Add manual method selector (`MANUAL_RAAST/JAZZCASH/EASYPAISA/BANK`) + optional customer note field. | High | Agent C | DONE | - | Submitted payload reflects selected method and note; validation remains intact. |
| CP-005 | Transactions (`transaction-list.tsx`) | Data Correctness | Remove misleading client-side type filtering over paginated data; either use server-side filter or relabel fallback clearly. | High | Agent C | BLOCKED | API-014 | Filtered totals + pagination must represent true server dataset. |
| CP-006 | Deliveries + Schedule date handling | Bug Fix | Replace timezone-sensitive date string generation with local-safe formatter (`YYYY-MM-DD` without UTC drift). | High | Agent C | DONE | - | Month filter and schedule range return expected boundary dates in PK timezone. |
| CP-007 | Auth (`use-auth.ts`, `middleware.ts`) | Security UX | Enforce CUSTOMER role at login/middleware level; handle wrong-role tokens with clean redirect/logout. | High | Agent C | DONE | - | Non-customer token cannot remain inside customer portal shell. |
| CP-008 | Transactions page UX | Responsive UX | Add mobile card/list mode for transactions; keep table for desktop only. | Medium | Agent C | DONE | - | Mobile (<640px) has readable transaction cards without horizontal table overflow. |
| CP-009 | Orders page UX | Feature Gap | Add status filter tabs/chips (All/Pending/Approved/Rejected/Cancelled) with page reset. | Medium | Agent C | DONE | - | Status filter updates query and resets page to 1. |
| CP-010 | Support page UX | Feature Gap | Add ticket status filter (All/Open/In Progress/Resolved/Closed) + clearer reply badge/preview. | Medium | Agent C | DONE | - | User can quickly isolate unresolved tickets and identify replied tickets. |
| CP-011 | Profile (`profile-card.tsx`) | Bug Fix | Add Sunday (`7`) day label mapping and ensure schedule day labels consistent across app. | Low | Agent C | DONE | - | Day labels display correctly for all 1..7 days. |
| CP-012 | Portal state invalidation | Reliability | Invalidate relevant queries (`portal-balance`, `portal-summary`, `payment-history`) on payment state transitions. | Medium | Agent C | DONE | - | Balance/summary/widgets refresh after successful payment status update. |
| CP-013 | UX consistency layer | UX Improvement | Standardize error/empty/loading/retry patterns across orders, payments, support, transactions. | Medium | Agent C | DONE | - | Shared behavior and visual consistency across all portal list pages. |
| CP-014 | QA coverage | Quality | Add real e2e smoke tests (login, pay flow shell, order create/cancel, ticket create, statement download trigger). | High | Agent C | DONE | - | Replace placeholder tests with runnable scenario tests. |

## Enhancement Sprint (After Closure)

| ID | Route / Module | Type | Task | Priority | Owner | Status | Depends On | Acceptance |
|---|---|---|---|---|---|---|---|---|
| CP-015 | Transactions API | API + FE | Add server-side filters (`type`, `dateFrom`, `dateTo`, `search`) and wire compact filter bar. | Medium | Agent C | BLOCKED | API-014 | Transaction history supports accurate filters without client-side mismatch. |
| CP-016 | Orders lifecycle | API + FE | Expose richer order fulfillment states (`PLANNED`, `OUT_FOR_DELIVERY`, `DELIVERED`) and show timeline in portal. | Medium | Agent C | BLOCKED | API-015 | Customer can see fulfillment progress after order approval. |
| CP-017 | Tickets enhancements | API + FE | Add ticket conversation timeline + optional attachment support for customer/vendor replies. | Medium | Agent C | BLOCKED | API-016 | Ticket detail shows chronological thread and attachments. |
| CP-018 | Product pricing for portal orders | API + FE | Return customer effective price in portal product payload and show in Place Order dialog. | Medium | Agent C | BLOCKED | API-017 | Portal order dialog shows customer-actual price, not generic base price. |
| CP-019 | Password policy consistency | Security UX | Align reset-password and change-password minimum policy (recommended min 8). | Medium | Agent C | READY | - | Both flows enforce same minimum and show same helper/error messaging. |
| CP-020 | Notification center | Feature | Connect bell icon to actual portal notifications (payment/ticket/order updates). | Low | Agent C | BLOCKED | API-018 (future) | Bell icon shows real unread count and list. |

## Execution Rule for Agent C

1. Pick only `READY` tasks first, one task per commit.
2. Commit format: `feat(CP-XXX): <short summary>` or `fix(CP-XXX): <short summary>`.
3. Update this file row (`Status`, `Notes`) after each pushed task.
4. Do not start `BLOCKED` tasks until dependency API card is approved and merged.
