# Phase 5 — End-to-End Tests: Customer Portal

**App:** customer-portal-e2e
**Test location:** `apps/customer-portal-e2e/src/e2e/`
**Framework:** Cypress 15
**Prerequisites:** Running customer-portal dev server + running api-backend

---

## Setup: Cypress Custom Commands for Customer Portal

### Modify `apps/customer-portal-e2e/src/support/commands.ts`

**Action:** Read existing file, then add:

```typescript
Cypress.Commands.add('loginAsCustomer', (email: string, password: string) => {
  cy.request('POST', `${Cypress.env('apiUrl')}/api/auth/login`, { email, password })
    .then((response) => {
      window.localStorage.setItem('accessToken', response.body.accessToken);
    });
  cy.visit('/home');
});
```

Add to `cypress.config.ts`:
```typescript
env: {
  apiUrl: 'http://localhost:3000',
  customerEmail: 'testcustomer@portal.test',
  customerPassword: 'TestPassword123!',
},
```

---

## TST-E2E-008: CP customer login and wallet view E2E

**Priority:** P0 Critical
**Type:** E2E

### File to Create
`apps/customer-portal-e2e/src/e2e/auth.cy.ts`

### Tasks

#### Task 1: Read existing E2E spec
**Action:** Read `apps/customer-portal-e2e/src/e2e/app.cy.ts`
Follow the same pattern.

#### Task 2: Write auth and wallet E2E
**Action:** Create `apps/customer-portal-e2e/src/e2e/auth.cy.ts`

```typescript
describe('Customer Portal Auth', () => {
  it('should redirect to login when unauthenticated', () => {
    cy.visit('/home');
    cy.url().should('include', '/auth/login');
  });

  it('should login and show wallet home page', () => {
    cy.visit('/auth/login');

    cy.get('input[type="email"], input[type="tel"]').type(Cypress.env('customerEmail'));
    cy.get('input[type="password"]').type(Cypress.env('customerPassword'));
    cy.get('button[type="submit"]').click();

    cy.url().should('include', '/home');
    // Wallet card should be visible
    cy.get('[data-testid="wallet-card"], .wallet-card').should('be.visible');
  });

  it('should display current balance on home page', () => {
    cy.loginAsCustomer(Cypress.env('customerEmail'), Cypress.env('customerPassword'));

    // Balance should be a number
    cy.contains(/Rs\.|PKR|balance/i).should('be.visible');
  });

  it('should show error on invalid credentials', () => {
    cy.visit('/auth/login');
    cy.get('input[type="email"], input[type="tel"]').type('wrong@test.com');
    cy.get('input[type="password"]').type('wrongpass');
    cy.get('button[type="submit"]').click();

    cy.get('[data-sonner-toast], [role="alert"], .toast').should('be.visible');
  });
});
```

### Acceptance Criteria
- [ ] File exists with 4 test cases
- [ ] Wallet card is asserted after successful login
- [ ] All tests pass: `npx nx e2e customer-portal-e2e --spec=src/e2e/auth.cy.ts`

---

## TST-E2E-009: CP make payment (manual method) E2E

**Priority:** P0 Critical
**Type:** E2E

### File to Create
`apps/customer-portal-e2e/src/e2e/payments.cy.ts`

### Tasks

#### Task 1: Read payment page and dialog
**Action:** Read:
- `apps/customer-portal/src/app/(portal)/payments/page.tsx`
- `apps/customer-portal/src/features/payments/components/payment-dialog.tsx`

Note how the dialog is opened and what buttons/inputs exist.

#### Task 2: Write payment E2E
**Action:** Create `apps/customer-portal-e2e/src/e2e/payments.cy.ts`

```typescript
describe('Customer Portal — Payments', () => {
  beforeEach(() => {
    cy.loginAsCustomer(Cypress.env('customerEmail'), Cypress.env('customerPassword'));
  });

  it('should navigate to payments page and see Make Payment button', () => {
    cy.visit('/payments');
    cy.contains('button', /make payment|pay now/i).should('be.visible');
  });

  it('should open payment dialog when Make Payment is clicked', () => {
    cy.visit('/payments');
    cy.contains('button', /make payment|pay now/i).click();
    cy.get('[role="dialog"]').should('be.visible');
    cy.get('input[type="number"]').should('be.visible'); // amount input
  });

  it('should complete manual payment submission flow', () => {
    cy.visit('/payments');
    cy.contains('button', /make payment|pay now/i).click();

    // Enter amount
    cy.get('input[type="number"]').type('500');

    // Switch to Manual tab
    cy.contains('[role="tab"]', /manual/i).click();

    // Select payment method (default is Raast)
    cy.contains('button', /jazzcash|raast|easypaisa|bank/i).first().click();

    // Fill reference number
    cy.get('input[placeholder*="transaction|TID|reference"]').type('REF123456');

    // Click Submit for Review
    cy.contains('button', /submit for review/i).click();

    // Dialog should close and success toast should show
    cy.get('[role="dialog"]').should('not.exist');
    cy.get('[data-sonner-toast], [role="alert"]').should('contain.text', /submitted|review/i);
  });
});
```

### Acceptance Criteria
- [ ] File exists with 3 test cases
- [ ] Manual payment flow test verifies success toast after submission
- [ ] All tests pass: `npx nx e2e customer-portal-e2e --spec=src/e2e/payments.cy.ts`

---

## TST-E2E-010: CP place order E2E

**Priority:** P1 High
**Type:** E2E

### File to Create
`apps/customer-portal-e2e/src/e2e/orders.cy.ts`

### Tasks

**Action:** Create `apps/customer-portal-e2e/src/e2e/orders.cy.ts`

Write 3 test cases:

1. `it('should navigate to orders page and see Place Order button')`
   - Visit `/orders`
   - Assert "Place Order" button visible

2. `it('should open place order dialog and show available products')`
   - Click Place Order
   - Assert dialog opens
   - Assert at least one product option visible

3. `it('should place an order and see it in the orders list')`
   - Click Place Order
   - Select a product (if dropdown)
   - Set quantity to 2
   - Click confirm
   - Assert new order appears with PENDING status

### Acceptance Criteria
- [ ] File exists with 3 test cases
- [ ] New order appears in the list after placement
- [ ] All tests pass

---

## TST-E2E-011: CP create support ticket and view reply E2E

**Priority:** P2 Medium
**Type:** E2E

### File to Create
`apps/customer-portal-e2e/src/e2e/support.cy.ts`

### Tasks

**Action:** Create `apps/customer-portal-e2e/src/e2e/support.cy.ts`

Write 3 test cases:

1. `it('should navigate to support page and see tickets list')`
   - Visit `/support`
   - Assert page heading visible

2. `it('should create a new support ticket')`
   - Click New Ticket or equivalent
   - Fill subject and message
   - Submit
   - Assert new ticket appears in list with OPEN status

3. `it('should open ticket detail and see message thread')`
   - Click on an existing ticket
   - Assert dialog/modal opens with message thread

### Acceptance Criteria
- [ ] File exists with 3 test cases
- [ ] All tests pass

---

## TST-E2E-012: CP change password E2E

**Priority:** P2 Medium
**Type:** E2E

### File to Create
`apps/customer-portal-e2e/src/e2e/profile.cy.ts`

### Tasks

**Action:** Create `apps/customer-portal-e2e/src/e2e/profile.cy.ts`

Write 2 test cases:

1. `it('should open change password dialog from profile page')`
   - Visit `/profile`
   - Click Change Password button
   - Assert dialog with old/new password fields opens

2. `it('should show validation error when new passwords do not match')`
   - Fill old password correctly
   - Fill new password and confirm with different values
   - Click Save
   - Assert mismatch error

### Acceptance Criteria
- [ ] File exists with 2 test cases
- [ ] All tests pass
