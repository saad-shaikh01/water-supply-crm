# Phase 5 — End-to-End Tests: Vendor Dashboard

**App:** vendor-dashboard-e2e
**Test location:** `apps/vendor-dashboard-e2e/src/e2e/`
**Framework:** Cypress 15
**Prerequisites:** Running vendor-dashboard dev server + running api-backend

---

## How the frontend stores auth (verified from source)

**Read `apps/vendor-dashboard/src/features/auth/hooks/use-auth.ts` before writing any Cypress test.**

Key facts:
- After login, tokens are stored in **cookies**: `auth_token` (1 day), `refresh_token` (7 days), `user_role` (7 days)
- Auth is **NOT stored in `localStorage`**
- Login field label is **"Email or Phone Number"**, field name is `identifier` (not `email`)
- On success: DRIVER role → `/dashboard/home`, all other roles → `/dashboard/overview`
- Customer form field is `phoneNumber` (not `phone`) — verified from `customer-form.tsx`

---

## Setup: Cypress Custom Commands

### Modify `apps/vendor-dashboard-e2e/src/support/commands.ts`

**Action:** Read the existing file first, then add:

```typescript
// Programmatic login: bypasses the UI form, sets auth cookies directly
Cypress.Commands.add('loginAsVendor', (identifier: string, password: string) => {
  cy.request({
    method: 'POST',
    url: `${Cypress.env('apiUrl')}/api/auth/login`,
    body: { identifier, password },   // 'identifier', not 'email'
  }).then((response) => {
    // Auth is stored in cookies, not localStorage
    cy.setCookie('auth_token', response.body.access_token, { path: '/' });
    cy.setCookie('refresh_token', response.body.refresh_token, { path: '/' });
    cy.setCookie('user_role', response.body.user.role, { path: '/' });
  });
});

Cypress.Commands.add('loginAsDriver', (identifier: string, password: string) => {
  cy.request({
    method: 'POST',
    url: `${Cypress.env('apiUrl')}/api/auth/login`,
    body: { identifier, password },
  }).then((response) => {
    cy.setCookie('auth_token', response.body.access_token, { path: '/' });
    cy.setCookie('refresh_token', response.body.refresh_token, { path: '/' });
    cy.setCookie('user_role', response.body.user.role, { path: '/' });
  });
});
```

### Modify `cypress.config.ts`

**Action:** Read `apps/vendor-dashboard-e2e/cypress.config.ts`, then add to the `env` block:

```typescript
env: {
  apiUrl: 'http://localhost:3000',
  vendorIdentifier: 'admin@watercrm.test',   // identifier, not vendorEmail
  vendorPassword: 'TestPassword123!',
  driverIdentifier: 'driver@watercrm.test',
  driverPassword: 'TestPassword123!',
},
```

---

## TST-E2E-001: VD vendor login and dashboard load E2E

**Priority:** P0 Critical
**Type:** E2E

### File to Create
`apps/vendor-dashboard-e2e/src/e2e/auth.cy.ts`

### Tasks

#### Task 1: Read existing E2E spec and Cypress config
**Action:** Read:
- `apps/vendor-dashboard-e2e/src/e2e/app.cy.ts`
- `apps/vendor-dashboard-e2e/cypress.config.ts`

Note the `baseUrl` and the pattern used in the existing spec.

#### Task 2: Write auth E2E tests
**Action:** Create `apps/vendor-dashboard-e2e/src/e2e/auth.cy.ts`

```typescript
describe('Vendor Dashboard — Auth', () => {
  it('should redirect unauthenticated visit to /auth/login', () => {
    cy.clearCookies();
    cy.visit('/dashboard/overview');
    cy.url().should('include', '/auth/login');
  });

  it('should show the identifier (email/phone) input, not an email-only input', () => {
    cy.visit('/auth/login');
    // Label reads "Email or Phone Number", input id is "identifier"
    cy.get('#identifier').should('be.visible');
    cy.contains('label', /email or phone/i).should('be.visible');
  });

  it('should login with valid credentials and redirect to /dashboard/overview', () => {
    cy.visit('/auth/login');
    cy.get('#identifier').type(Cypress.env('vendorIdentifier'));
    cy.get('#password').type(Cypress.env('vendorPassword'));
    cy.get('button[type="submit"]').click();

    // Cookies must be set — not localStorage
    cy.getCookie('auth_token').should('exist');
    cy.getCookie('refresh_token').should('exist');
    cy.url().should('include', '/dashboard/overview');
  });

  it('should show an error toast on invalid credentials', () => {
    cy.visit('/auth/login');
    cy.get('#identifier').type('wrong@test.com');
    cy.get('#password').type('wrongpassword');
    cy.get('button[type="submit"]').click();

    cy.get('[data-sonner-toast], [role="alert"]').should('contain.text', /invalid/i);
    cy.url().should('include', '/auth/login');
  });
});
```

### Acceptance Criteria
- [ ] File uses `cy.setCookie` in commands — **not** `localStorage.setItem`
- [ ] Login test targets `#identifier` — **not** `input[type="email"]`
- [ ] Cookie existence (`auth_token`) is asserted after successful login
- [ ] All tests pass: `npx nx e2e vendor-dashboard-e2e --spec=src/e2e/auth.cy.ts`

---

## TST-E2E-002: VD customer create and edit E2E

**Priority:** P0 Critical
**Type:** E2E

### File to Create
`apps/vendor-dashboard-e2e/src/e2e/customers.cy.ts`

### Tasks

#### Task 1: Read customer form component to verify field names
**Action:** Read `apps/vendor-dashboard/src/features/customers/components/customer-form.tsx`

Confirmed field names from source:
- Name field: `EMPTY_DEFAULTS.name` → `register('name')`
- Phone field: `EMPTY_DEFAULTS.phoneNumber` → **`register('phoneNumber')`** — not `phone`
- Address field: `register('address')`
- The form is a `<Sheet>` (slide-over panel), not a `<Dialog>`
- The component renders in a slide-over: look for `SheetContent`, `SheetTitle`

#### Task 2: Write customer E2E tests
**Action:** Create `apps/vendor-dashboard-e2e/src/e2e/customers.cy.ts`

```typescript
describe('Vendor Dashboard — Customers', () => {
  beforeEach(() => {
    cy.loginAsVendor(Cypress.env('vendorIdentifier'), Cypress.env('vendorPassword'));
    cy.visit('/dashboard/customers');
  });

  it('should display the customers list page with a table', () => {
    cy.contains(/customers/i).should('be.visible');
    cy.get('table, [role="table"]').should('be.visible');
  });

  it('should open the Add Customer slide-over when the button is clicked', () => {
    cy.contains('button', /add customer/i).click();
    // CustomerForm is a Sheet (slide-over), not a Dialog
    cy.get('[data-slot="sheet-content"], [role="dialog"]').should('be.visible');
    // Name input
    cy.get('input#name, input[name="name"]').should('be.visible');
  });

  it('should create a new customer using phoneNumber field (not phone)', () => {
    const uniqueName = `E2E Customer ${Date.now()}`;

    cy.contains('button', /add customer/i).click();

    cy.get('input[name="name"], input#name').type(uniqueName);
    // Field is phoneNumber — verified from customer-form.tsx EMPTY_DEFAULTS
    cy.get('input[name="phoneNumber"], input#phoneNumber').type('03001234567');
    cy.get('input[name="address"], input#address').type('123 E2E Test Street, Karachi');

    cy.contains('button', /save|create|submit/i).click();

    // Slide-over closes; new customer appears in table
    cy.get('[data-slot="sheet-content"], [role="dialog"]').should('not.exist');
    cy.contains(uniqueName).should('be.visible');
  });
});
```

### Acceptance Criteria
- [ ] Phone field targeted as `phoneNumber` — **not** `phone`
- [ ] Slide-over selector accounts for `SheetContent` component
- [ ] All tests pass: `npx nx e2e vendor-dashboard-e2e --spec=src/e2e/customers.cy.ts`

---

## TST-E2E-003: VD daily sheet generate and complete E2E

**Priority:** P0 Critical
**Type:** E2E

### File to Create
`apps/vendor-dashboard-e2e/src/e2e/daily-sheets.cy.ts`

### Tasks

#### Task 1: Read daily sheet UI
**Action:** Read `apps/vendor-dashboard/src/features/daily-sheets/components/sheet-generate.tsx`
Find the form field names (van selector, date input) and button labels.

#### Task 2: Write daily sheet E2E
**Action:** Create `apps/vendor-dashboard-e2e/src/e2e/daily-sheets.cy.ts`

```typescript
describe('Vendor Dashboard — Daily Sheets', () => {
  beforeEach(() => {
    cy.loginAsVendor(Cypress.env('vendorIdentifier'), Cypress.env('vendorPassword'));
    cy.visit('/dashboard/daily-sheets');
  });

  it('should display the daily sheets list', () => {
    cy.contains(/daily sheets/i).should('be.visible');
  });

  it('should open generate sheet dialog when Generate button is clicked', () => {
    cy.contains('button', /generate/i).click();
    cy.get('[role="dialog"]').should('be.visible');
  });

  it('should generate a daily sheet for a van and navigate to sheet detail', () => {
    cy.contains('button', /generate/i).click();

    // Select the first available van from the dropdown
    // Adjust selector to match actual van select component
    cy.get('[data-testid="van-select"] button, select[name="vanId"]').first().click();
    cy.get('[role="option"]').first().click(); // pick first van

    cy.contains('button', /generate|confirm/i).click();

    // After generation, navigates to detail page
    cy.url().should('match', /\/dashboard\/daily-sheets\/.+/);
  });
});
```

### Acceptance Criteria
- [ ] File exists with 3 test cases
- [ ] All tests pass

---

## TST-E2E-004: VD record payment and adjust balance E2E

**Priority:** P1 High
**Type:** E2E

### File to Create
`apps/vendor-dashboard-e2e/src/e2e/transactions.cy.ts`

### Tasks

**Action:** Read `apps/vendor-dashboard/src/features/transactions/components/payment-form.tsx` and `adjustment-form.tsx` to find button labels and input names.

Create `apps/vendor-dashboard-e2e/src/e2e/transactions.cy.ts` with 3 test cases:

1. `it('should display transactions page with list')`
   - Login, visit `/dashboard/transactions`
   - Assert table/list visible

2. `it('should open Record Payment form and fill an amount')`
   - Navigate to a customer's detail page
   - Click Record Payment
   - Fill amount
   - Assert form is visible with correct inputs

3. `it('should submit a payment and see a success notification')`
   - Complete and submit the payment form
   - Assert success toast

### Acceptance Criteria
- [ ] File exists with 3 test cases
- [ ] All tests pass

---

## TST-E2E-005: VD order dispatch flow E2E

**Priority:** P1 High
**Type:** E2E

### File to Create
`apps/vendor-dashboard-e2e/src/e2e/orders.cy.ts`

### Tasks

**Action:** Read `apps/vendor-dashboard/src/app/dashboard/orders/page.tsx` to understand page structure.

Create `apps/vendor-dashboard-e2e/src/e2e/orders.cy.ts` with 3 test cases:

1. `it('should display orders list page')`
2. `it('should dispatch a PENDING order and see status change')`
3. `it('should reject a PENDING order with a reason')`

### Acceptance Criteria
- [ ] File exists with 3 test cases
- [ ] All tests pass

---

## TST-E2E-006: VD analytics page date filter and export E2E

**Priority:** P2 Medium
**Type:** E2E

### File to Create
`apps/vendor-dashboard-e2e/src/e2e/analytics.cy.ts`

**Action:** Create with 3 test cases:
1. `it('should load analytics with Financial tab active by default')`
2. `it('should switch to Deliveries tab')`
3. `it('should show Export CSV and Export PDF buttons')`

---

## TST-E2E-007: VD driver login and home page E2E

**Priority:** P1 High
**Type:** E2E

### File to Create
`apps/vendor-dashboard-e2e/src/e2e/driver.cy.ts`

### Tasks

**Action:** Create `apps/vendor-dashboard-e2e/src/e2e/driver.cy.ts`

```typescript
describe('Vendor Dashboard — Driver Role', () => {
  it('should redirect DRIVER login to /dashboard/home (not /dashboard/overview)', () => {
    cy.visit('/auth/login');
    cy.get('#identifier').type(Cypress.env('driverIdentifier'));
    cy.get('#password').type(Cypress.env('driverPassword'));
    cy.get('button[type="submit"]').click();

    // Per use-auth.ts: role === 'DRIVER' → router.push('/dashboard/home')
    cy.url().should('include', '/dashboard/home');
  });

  it('should render driver home page stats', () => {
    cy.loginAsDriver(Cypress.env('driverIdentifier'), Cypress.env('driverPassword'));
    cy.visit('/dashboard/home');
    cy.get('h1, h2').should('be.visible');
  });

  it('should navigate to /dashboard/history from sidebar', () => {
    cy.loginAsDriver(Cypress.env('driverIdentifier'), Cypress.env('driverPassword'));
    cy.visit('/dashboard/home');

    cy.contains('a', /my history|history/i).click();
    cy.url().should('include', '/dashboard/history');
  });
});
```

### Acceptance Criteria
- [ ] DRIVER redirect test verifies URL is `/dashboard/home` — **not** `/dashboard/overview`
- [ ] Login uses `#identifier` input — not `input[type="email"]`
- [ ] All tests pass
