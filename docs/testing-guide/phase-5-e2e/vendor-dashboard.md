# Phase 5 — End-to-End Tests: Vendor Dashboard

**App:** vendor-dashboard-e2e
**Test location:** `apps/vendor-dashboard-e2e/src/e2e/`
**Framework:** Cypress 15
**Prerequisites:** Running vendor-dashboard dev server + running api-backend

---

## Setup: Cypress Custom Commands

Before implementing any E2E ticket, add reusable Cypress commands.

### Modify `apps/vendor-dashboard-e2e/src/support/commands.ts`

**Action:** Read the existing file first, then add these commands:

```typescript
// Login command — logs in as vendor admin and stores session
Cypress.Commands.add('loginAsVendor', (email: string, password: string) => {
  cy.request('POST', `${Cypress.env('apiUrl')}/api/auth/login`, { email, password })
    .then((response) => {
      window.localStorage.setItem('accessToken', response.body.accessToken);
      // Store refresh token cookie if applicable
    });
  cy.visit('/dashboard/overview');
});

// Intercept and stub API calls
Cypress.Commands.add('stubApi', (method: string, url: string, body: object, status = 200) => {
  cy.intercept(method, `${Cypress.env('apiUrl')}${url}`, { statusCode: status, body }).as(url.replace(/\//g, '_'));
});
```

Add to `cypress.config.ts` (read it first, then add):
```typescript
env: {
  apiUrl: 'http://localhost:3000',
  vendorEmail: 'testvendor@watercrm.test',
  vendorPassword: 'TestPassword123!',
  driverEmail: 'driver@watercrm.test',
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

#### Task 1: Read existing E2E spec
**Action:** Read `apps/vendor-dashboard-e2e/src/e2e/app.cy.ts`
Understand how the existing spec navigates and what it asserts. Follow the same pattern.

#### Task 2: Write auth E2E tests
**Action:** Create `apps/vendor-dashboard-e2e/src/e2e/auth.cy.ts`

```typescript
describe('Vendor Dashboard Auth', () => {
  it('should redirect to login page when unauthenticated', () => {
    cy.visit('/dashboard/overview');
    cy.url().should('include', '/auth/login');
  });

  it('should login with valid credentials and land on dashboard', () => {
    cy.visit('/auth/login');

    cy.get('input[type="email"]').type(Cypress.env('vendorEmail'));
    cy.get('input[type="password"]').type(Cypress.env('vendorPassword'));
    cy.get('button[type="submit"]').click();

    cy.url().should('include', '/dashboard');
    cy.get('h1, h2').should('be.visible'); // some heading on the dashboard
  });

  it('should show error message with invalid credentials', () => {
    cy.visit('/auth/login');

    cy.get('input[type="email"]').type('wrong@test.com');
    cy.get('input[type="password"]').type('wrongpassword');
    cy.get('button[type="submit"]').click();

    cy.get('[data-sonner-toast], .toast, [role="alert"]').should('be.visible');
    cy.url().should('include', '/auth/login');
  });

  it('should logout and redirect to login page', () => {
    cy.loginAsVendor(Cypress.env('vendorEmail'), Cypress.env('vendorPassword'));

    // Click logout button (find via data-testid or aria-label)
    cy.get('[aria-label="logout"], [data-testid="logout-btn"]').click();

    cy.url().should('include', '/auth/login');
  });
});
```

### Acceptance Criteria
- [ ] File exists with 4 test cases
- [ ] Login test verifies URL redirect after successful login
- [ ] Invalid credentials test verifies error toast/alert
- [ ] All tests pass: `npx nx e2e vendor-dashboard-e2e --spec=src/e2e/auth.cy.ts`

---

## TST-E2E-002: VD customer create and edit E2E

**Priority:** P0 Critical
**Type:** E2E

### File to Create
`apps/vendor-dashboard-e2e/src/e2e/customers.cy.ts`

### Tasks

#### Task 1: Identify UI selectors
**Action:** Read `apps/vendor-dashboard/src/features/customers/components/customer-list.tsx` and `customer-form.tsx`
Note button labels, input labels, and any `data-testid` attributes.

#### Task 2: Write customer E2E tests
**Action:** Create `apps/vendor-dashboard-e2e/src/e2e/customers.cy.ts`

```typescript
describe('Vendor Dashboard — Customers', () => {
  beforeEach(() => {
    cy.loginAsVendor(Cypress.env('vendorEmail'), Cypress.env('vendorPassword'));
    cy.visit('/dashboard/customers');
  });

  it('should display the customers list page', () => {
    cy.get('h1, h2').should('contain.text', 'Customers');
    cy.get('table, [role="table"]').should('be.visible');
  });

  it('should open create customer form when Add Customer button is clicked', () => {
    cy.contains('button', /add customer/i).click();
    cy.get('[role="dialog"]').should('be.visible');
    cy.get('input[name="name"], input[placeholder*="Name"]').should('be.visible');
  });

  it('should create a new customer and see them in the list', () => {
    const uniqueName = `Test Customer ${Date.now()}`;

    cy.contains('button', /add customer/i).click();

    cy.get('input[name="name"]').type(uniqueName);
    cy.get('input[name="phone"]').type('03001234567');
    cy.get('input[name="address"]').type('123 Test Street, Karachi');
    // Fill other required fields as they appear in the form

    cy.contains('button', /save|create|submit/i).click();

    // Dialog should close and new customer should appear in table
    cy.get('[role="dialog"]').should('not.exist');
    cy.contains(uniqueName).should('be.visible');
  });
});
```

### Acceptance Criteria
- [ ] File exists with 3 test cases
- [ ] Create customer test uses a unique name (no collision with existing data)
- [ ] All tests pass: `npx nx e2e vendor-dashboard-e2e --spec=src/e2e/customers.cy.ts`

---

## TST-E2E-003: VD daily sheet generate and complete E2E

**Priority:** P0 Critical
**Type:** E2E

### File to Create
`apps/vendor-dashboard-e2e/src/e2e/daily-sheets.cy.ts`

### Tasks

#### Task 1: Read daily sheet UI components
**Action:** Read `apps/vendor-dashboard/src/features/daily-sheets/components/sheet-generate.tsx` and `sheet-list.tsx`
Note button labels and form fields for sheet generation.

#### Task 2: Write daily sheet E2E
**Action:** Create `apps/vendor-dashboard-e2e/src/e2e/daily-sheets.cy.ts`

```typescript
describe('Vendor Dashboard — Daily Sheets', () => {
  beforeEach(() => {
    cy.loginAsVendor(Cypress.env('vendorEmail'), Cypress.env('vendorPassword'));
    cy.visit('/dashboard/daily-sheets');
  });

  it('should display the daily sheets list', () => {
    cy.get('h1, h2').should('contain.text', /daily sheets|sheets/i);
  });

  it('should open generate sheet dialog when Generate button is clicked', () => {
    cy.contains('button', /generate/i).click();
    cy.get('[role="dialog"]').should('be.visible');
  });

  it('should generate a sheet for today and navigate to sheet detail', () => {
    cy.contains('button', /generate/i).click();

    // Select a van from the dropdown
    cy.get('[data-testid="van-select"], select[name="vanId"]').select(0);

    // Date defaults to today — verify it's pre-filled or set it
    const today = new Date().toISOString().split('T')[0];
    cy.get('input[type="date"], input[name="date"]').should('have.value', today);

    cy.contains('button', /generate|confirm/i).click();

    // Should navigate to the new sheet detail page
    cy.url().should('match', /\/dashboard\/daily-sheets\/.+/);
  });
});
```

### Acceptance Criteria
- [ ] File exists with 3 test cases
- [ ] Sheet generation test verifies URL change to detail page
- [ ] All tests pass

---

## TST-E2E-004: VD record payment and adjust balance E2E

**Priority:** P1 High
**Type:** E2E

### File to Create
`apps/vendor-dashboard-e2e/src/e2e/transactions.cy.ts`

### Tasks

#### Task 1: Read transaction UI
**Action:** Read `apps/vendor-dashboard/src/features/transactions/components/payment-form.tsx`

#### Task 2: Write transaction E2E
**Action:** Create `apps/vendor-dashboard-e2e/src/e2e/transactions.cy.ts`

Write 3 test cases:

1. `it('should display transactions page with list')`
   - Visit `/dashboard/transactions`
   - Assert transactions table visible

2. `it('should open Record Payment dialog and submit a payment')`
   - Visit customer detail page
   - Click Record Payment
   - Fill amount
   - Submit
   - Assert toast success and updated balance in UI

3. `it('should open Adjustment dialog and apply a credit')`
   - Click Apply Adjustment
   - Fill negative amount (e.g., -50)
   - Submit
   - Assert balance decreases

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

#### Task 1: Read orders page
**Action:** Read `apps/vendor-dashboard/src/app/dashboard/orders/page.tsx`

#### Task 2: Write order dispatch E2E
**Action:** Create `apps/vendor-dashboard-e2e/src/e2e/orders.cy.ts`

Write 3 test cases:

1. `it('should display orders list')`
   - Visit `/dashboard/orders`
   - Assert table visible

2. `it('should open dispatch drawer for a PENDING order and dispatch it')`
   - Click dispatch button on a PENDING order
   - Confirm in drawer
   - Assert status changes to DISPATCHED

3. `it('should open reject dialog and reject a PENDING order with reason')`
   - Click reject button
   - Type a rejection reason
   - Confirm rejection
   - Assert status changes to REJECTED

### Acceptance Criteria
- [ ] File exists with 3 test cases
- [ ] Status change is visually asserted after action

---

## TST-E2E-006: VD analytics page date filter and export E2E

**Priority:** P2 Medium
**Type:** E2E

### File to Create
`apps/vendor-dashboard-e2e/src/e2e/analytics.cy.ts`

### Tasks

Write 3 test cases:

1. `it('should load analytics page with Financial tab active by default')`
   - Visit `/dashboard/analytics`
   - Assert Financial tab is selected

2. `it('should switch to Deliveries tab and render delivery content')`
   - Click Deliveries tab
   - Assert delivery-specific content visible

3. `it('should render Export CSV and Export PDF buttons')`
   - Assert both export buttons are visible and enabled

### Acceptance Criteria
- [ ] File exists with 3 test cases
- [ ] All tests pass

---

## TST-E2E-007: VD driver login and home page E2E

**Priority:** P1 High
**Type:** E2E

### File to Create
`apps/vendor-dashboard-e2e/src/e2e/driver.cy.ts`

### Tasks

Write 3 test cases:

1. `it('should redirect DRIVER login to /dashboard/home')`
   - Visit login page
   - Login with driver credentials
   - Assert URL is `/dashboard/home`

2. `it('should render driver home page with today stats')`
   - Login as driver
   - Assert stats cards visible (deliveries, empties, etc.)

3. `it('should navigate to driver history page')`
   - Click My History link in sidebar
   - Assert URL changes to `/dashboard/history`

### Acceptance Criteria
- [ ] File exists with 3 test cases
- [ ] DRIVER login redirect is explicitly verified
- [ ] All tests pass
