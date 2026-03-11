# Water Supply CRM — Testing Guide

Comprehensive testing plan for the Water Supply CRM monorepo covering unit tests, integration tests, and end-to-end tests across all three applications.

---

## Tech Stack

| Layer | Framework | Config |
|-------|-----------|--------|
| Backend unit/integration | Jest + `@nestjs/testing` + `jest-mock-extended` | `apps/api-backend/jest.config.cts` |
| Frontend unit/component | Jest + `@testing-library/react` | `apps/*/jest.config.cts` |
| E2E (browser) | Cypress 15 | `apps/*-e2e/cypress.config.ts` |
| E2E (API) | Jest + Supertest | `apps/api-backend-e2e/jest.config.cts` |

---

## Phase Overview

| Phase | Name | Ticket Range | Files |
|-------|------|-------------|-------|
| 1 | Infrastructure & Setup | TST-INF-001–005 | [phase-1-infrastructure.md](./phase-1-infrastructure.md) |
| 2 | Backend Unit Tests | TST-BE-001–064 | [phase-2-backend/](./phase-2-backend/) |
| 3 | Backend Integration Tests | TST-INT-001–016 | [phase-3-backend-integration/](./phase-3-backend-integration/) |
| 4 | Frontend Unit Tests | TST-FE-001–048 | [phase-4-frontend/](./phase-4-frontend/) |
| 5 | End-to-End Tests | TST-E2E-001–027 | [phase-5-e2e/](./phase-5-e2e/) |

---

## All Tickets — Master Index

### Phase 1: Infrastructure

| Ticket | Title | Priority |
|--------|-------|----------|
| TST-INF-001 | Install jest-mock-extended and configure prisma mock | P0 |
| TST-INF-002 | Create shared test helpers for NestJS testing module | P0 |
| TST-INF-003 | Create mock data factories for all Prisma models | P0 |
| TST-INF-004 | Configure Jest coverage thresholds across all apps | P1 |
| TST-INF-005 | Add test scripts to root package.json | P1 |

### Phase 2: Backend Unit Tests

| Ticket | Title | File | Priority |
|--------|-------|------|----------|
| TST-BE-001 | AuthService.login() unit tests | [auth.md](./phase-2-backend/auth.md) | P0 |
| TST-BE-002 | AuthService.refreshToken() unit tests | [auth.md](./phase-2-backend/auth.md) | P0 |
| TST-BE-003 | AuthService.forgotPassword() & resetPassword() unit tests | [auth.md](./phase-2-backend/auth.md) | P1 |
| TST-BE-004 | JwtAuthGuard and RolesGuard unit tests | [auth.md](./phase-2-backend/auth.md) | P0 |
| TST-BE-005 | CustomerService.findAll() with pagination unit tests | [customer.md](./phase-2-backend/customer.md) | P0 |
| TST-BE-006 | CustomerService.create() and update() unit tests | [customer.md](./phase-2-backend/customer.md) | P0 |
| TST-BE-007 | CustomerService custom pricing CRUD unit tests | [customer.md](./phase-2-backend/customer.md) | P1 |
| TST-BE-008 | CustomerService.getStatement() unit tests | [customer.md](./phase-2-backend/customer.md) | P1 |
| TST-BE-009 | DailySheetService.generateForVan() unit tests | [daily-sheet.md](./phase-2-backend/daily-sheet.md) | P0 |
| TST-BE-010 | DailySheetService delivery item update unit tests | [daily-sheet.md](./phase-2-backend/daily-sheet.md) | P0 |
| TST-BE-011 | DailySheetProcessor BullMQ job unit tests | [daily-sheet.md](./phase-2-backend/daily-sheet.md) | P1 |
| TST-BE-012 | PaymentService.initiateRaastQr() unit tests | [payment.md](./phase-2-backend/payment.md) | P0 |
| TST-BE-013 | PaymentService Paymob webhook handler unit tests | [payment.md](./phase-2-backend/payment.md) | P0 |
| TST-BE-014 | PaymentService.submitManualPayment() unit tests | [payment.md](./phase-2-backend/payment.md) | P1 |
| TST-BE-015 | TransactionService ledger recording unit tests | [transaction.md](./phase-2-backend/transaction.md) | P0 |
| TST-BE-016 | TransactionService balance calculation unit tests | [transaction.md](./phase-2-backend/transaction.md) | P0 |
| TST-BE-017 | OrderService.create() and status transition unit tests | [order.md](./phase-2-backend/order.md) | P1 |
| TST-BE-018 | OrderService.dispatch() unit tests | [order.md](./phase-2-backend/order.md) | P1 |
| TST-BE-019 | TicketService.create() and message threading unit tests | [ticket.md](./phase-2-backend/ticket.md) | P1 |
| TST-BE-020 | TicketService.close() unit tests | [ticket.md](./phase-2-backend/ticket.md) | P2 |
| TST-BE-021 | ProductService CRUD unit tests | [product.md](./phase-2-backend/product.md) | P1 |
| TST-BE-022 | VanService CRUD and soft-disable unit tests | [van.md](./phase-2-backend/van.md) | P1 |
| TST-BE-023 | RouteService CRUD and van assignment unit tests | [route.md](./phase-2-backend/route.md) | P1 |
| TST-BE-024 | UserService CRUD and password change unit tests | [user.md](./phase-2-backend/user.md) | P1 |
| TST-BE-025 | AnalyticsService financial report unit tests | [analytics.md](./phase-2-backend/analytics.md) | P2 |
| TST-BE-026 | AnalyticsService deliveries and customers report unit tests | [analytics.md](./phase-2-backend/analytics.md) | P2 |
| TST-BE-027 | NotificationService send and preference unit tests | [notification.md](./phase-2-backend/notification.md) | P2 |
| TST-BE-028 | TrackingService location update and fleet status unit tests | [tracking.md](./phase-2-backend/tracking.md) | P2 |
| TST-BE-029 | VendorService CRUD unit tests (admin) | [vendor.md](./phase-2-backend/vendor.md) | P1 |
| TST-BE-030 | VendorContextInterceptor unit tests | [vendor.md](./phase-2-backend/vendor.md) | P0 |

### Phase 3: Backend Integration Tests

| Ticket | Title | File | Priority |
|--------|-------|------|----------|
| TST-INT-001 | Auth login → JWT → protected route integration test | [auth-flow.md](./phase-3-backend-integration/auth-flow.md) | P0 |
| TST-INT-002 | Auth refresh token rotation integration test | [auth-flow.md](./phase-3-backend-integration/auth-flow.md) | P0 |
| TST-INT-003 | Multi-tenant vendorId isolation integration test | [auth-flow.md](./phase-3-backend-integration/auth-flow.md) | P0 |
| TST-INT-004 | Daily sheet generation end-to-end (API level) | [daily-sheet-flow.md](./phase-3-backend-integration/daily-sheet-flow.md) | P0 |
| TST-INT-005 | Daily sheet delivery item update + ledger entry integration | [daily-sheet-flow.md](./phase-3-backend-integration/daily-sheet-flow.md) | P0 |
| TST-INT-006 | Daily sheet close + balance update integration | [daily-sheet-flow.md](./phase-3-backend-integration/daily-sheet-flow.md) | P1 |
| TST-INT-007 | Paymob webhook → payment status → balance update integration | [payment-flow.md](./phase-3-backend-integration/payment-flow.md) | P0 |
| TST-INT-008 | Manual payment submission → vendor review → approve integration | [payment-flow.md](./phase-3-backend-integration/payment-flow.md) | P1 |
| TST-INT-009 | Customer portal login → profile fetch integration | [customer-portal-flow.md](./phase-3-backend-integration/customer-portal-flow.md) | P0 |
| TST-INT-010 | Customer portal balance + transactions integration | [customer-portal-flow.md](./phase-3-backend-integration/customer-portal-flow.md) | P1 |
| TST-INT-011 | Customer portal order placement integration | [customer-portal-flow.md](./phase-3-backend-integration/customer-portal-flow.md) | P1 |
| TST-INT-012 | Customer portal support ticket creation and reply integration | [customer-portal-flow.md](./phase-3-backend-integration/customer-portal-flow.md) | P2 |

### Phase 4: Frontend Unit Tests

| Ticket | Title | File | Priority |
|--------|-------|------|----------|
| TST-FE-001 | VD LoginForm component tests | [vd-auth.md](./phase-4-frontend/vd-auth.md) | P0 |
| TST-FE-002 | VD ForgotPasswordForm and ResetPasswordForm component tests | [vd-auth.md](./phase-4-frontend/vd-auth.md) | P1 |
| TST-FE-003 | VD CustomerList component tests (render, filter, pagination) | [vd-customers.md](./phase-4-frontend/vd-customers.md) | P0 |
| TST-FE-004 | VD CustomerForm (create/edit) component tests | [vd-customers.md](./phase-4-frontend/vd-customers.md) | P1 |
| TST-FE-005 | VD CustomerDetail tabs component tests | [vd-customers.md](./phase-4-frontend/vd-customers.md) | P2 |
| TST-FE-006 | VD SheetList component tests (filter, date range) | [vd-daily-sheets.md](./phase-4-frontend/vd-daily-sheets.md) | P0 |
| TST-FE-007 | VD SheetDetail delivery item update tests | [vd-daily-sheets.md](./phase-4-frontend/vd-daily-sheets.md) | P1 |
| TST-FE-008 | VD TransactionList and PaymentRequestList tests | [vd-transactions.md](./phase-4-frontend/vd-transactions.md) | P1 |
| TST-FE-009 | VD PaymentForm and AdjustmentForm component tests | [vd-transactions.md](./phase-4-frontend/vd-transactions.md) | P1 |
| TST-FE-010 | VD AnalyticsTabs component tests (date range, tab switch) | [vd-analytics.md](./phase-4-frontend/vd-analytics.md) | P2 |
| TST-FE-011 | VD OrderList and OrderDispatchDrawer component tests | [vd-orders.md](./phase-4-frontend/vd-orders.md) | P1 |
| TST-FE-012 | CP LoginForm component tests | [cp-auth.md](./phase-4-frontend/cp-auth.md) | P0 |
| TST-FE-013 | CP PaymentDialog (Raast QR flow) component tests | [cp-payments.md](./phase-4-frontend/cp-payments.md) | P0 |
| TST-FE-014 | CP PaymentDialog (manual payment flow) component tests | [cp-payments.md](./phase-4-frontend/cp-payments.md) | P1 |
| TST-FE-015 | CP PlaceOrderDialog component tests | [cp-orders.md](./phase-4-frontend/cp-orders.md) | P1 |
| TST-FE-016 | CP CreateTicketDialog and TicketDetailDialog tests | [cp-tickets.md](./phase-4-frontend/cp-tickets.md) | P2 |
| TST-FE-017 | AP LoginForm and SignupForm component tests | [ap-auth.md](./phase-4-frontend/ap-auth.md) | P1 |
| TST-FE-018 | AP VendorList and VendorForm component tests | [ap-vendors.md](./phase-4-frontend/ap-vendors.md) | P1 |

### Phase 5: End-to-End Tests

| Ticket | Title | File | Priority |
|--------|-------|------|----------|
| TST-E2E-001 | VD vendor login and dashboard load E2E | [vendor-dashboard.md](./phase-5-e2e/vendor-dashboard.md) | P0 |
| TST-E2E-002 | VD customer create and edit E2E | [vendor-dashboard.md](./phase-5-e2e/vendor-dashboard.md) | P0 |
| TST-E2E-003 | VD daily sheet generate and complete E2E | [vendor-dashboard.md](./phase-5-e2e/vendor-dashboard.md) | P0 |
| TST-E2E-004 | VD record payment and adjust balance E2E | [vendor-dashboard.md](./phase-5-e2e/vendor-dashboard.md) | P1 |
| TST-E2E-005 | VD order dispatch flow E2E | [vendor-dashboard.md](./phase-5-e2e/vendor-dashboard.md) | P1 |
| TST-E2E-006 | VD analytics page date filter and export E2E | [vendor-dashboard.md](./phase-5-e2e/vendor-dashboard.md) | P2 |
| TST-E2E-007 | VD driver login and home page E2E | [vendor-dashboard.md](./phase-5-e2e/vendor-dashboard.md) | P1 |
| TST-E2E-008 | CP customer login and wallet view E2E | [customer-portal.md](./phase-5-e2e/customer-portal.md) | P0 |
| TST-E2E-009 | CP make payment (manual method) E2E | [customer-portal.md](./phase-5-e2e/customer-portal.md) | P0 |
| TST-E2E-010 | CP place order E2E | [customer-portal.md](./phase-5-e2e/customer-portal.md) | P1 |
| TST-E2E-011 | CP create support ticket and view reply E2E | [customer-portal.md](./phase-5-e2e/customer-portal.md) | P2 |
| TST-E2E-012 | CP change password E2E | [customer-portal.md](./phase-5-e2e/customer-portal.md) | P2 |
| TST-E2E-013 | AP admin login and vendor creation E2E | [admin-panel.md](./phase-5-e2e/admin-panel.md) | P0 |
| TST-E2E-014 | AP vendor enable/disable E2E | [admin-panel.md](./phase-5-e2e/admin-panel.md) | P1 |
| TST-E2E-015 | AP product management E2E | [admin-panel.md](./phase-5-e2e/admin-panel.md) | P2 |

---

## Coverage Targets

| App | Statements | Branches | Functions | Lines |
|-----|-----------|---------|-----------|-------|
| api-backend | 80% | 70% | 80% | 80% |
| vendor-dashboard | 60% | 50% | 60% | 60% |
| customer-portal | 60% | 50% | 60% | 60% |
| admin-panel | 60% | 50% | 60% | 60% |

---

## Running Tests

```bash
# Run all unit tests
npx nx run-many -t test --all

# Run single app unit tests
npx nx test api-backend
npx nx test vendor-dashboard
npx nx test customer-portal
npx nx test admin-panel

# Run with coverage
npx nx test api-backend --coverage

# Run single spec file
npx nx test api-backend --testFile=src/app/modules/auth/auth.service.spec.ts

# Run E2E
npx nx e2e vendor-dashboard-e2e
npx nx e2e customer-portal-e2e
npx nx e2e admin-panel-e2e
```

---

## Conventions

### File Location Rules
- Backend unit test: same folder as source file, `*.spec.ts`
- Backend integration test: `apps/api-backend-e2e/src/` folder
- Frontend component test: `apps/<app>/src/features/<feature>/components/__tests__/*.spec.tsx`
- Frontend hook test: `apps/<app>/src/features/<feature>/hooks/__tests__/*.spec.ts`
- Cypress E2E: `apps/<app>-e2e/src/e2e/*.cy.ts`

### Mock Patterns
- Backend: use `jest-mock-extended` `mockDeep<PrismaService>()`
- Frontend hooks: mock API functions with `jest.fn()`
- Frontend components: use `msw` (Mock Service Worker) for API interception in integration-style component tests
- Cypress: use `cy.intercept()` to stub API calls

### Test Data
All shared mock data factories live in:
`apps/api-backend/src/test/factories/` (created in TST-INF-003)
