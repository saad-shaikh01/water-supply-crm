# Phase 5 — End-to-End Tests: Admin Panel

**App:** admin-panel-e2e
**Test location:** `apps/admin-panel-e2e/src/e2e/` (or `cypress/e2e/`)
**Framework:** Cypress 15
**Prerequisites:** Running admin-panel dev server + running api-backend

---

## Setup: Cypress Custom Commands for Admin Panel

### Modify `apps/admin-panel-e2e/src/support/commands.ts` (or `cypress/support/commands.ts`)

**Action:** Read the existing support file path first (check `apps/admin-panel-e2e/`), then add:

> **Corrected (Phase 5):** the API login is `POST /api/auth/login` with `{ identifier, password }` and answers
> `{ access_token, refresh_token, expires_in, user }` (snake_case). The panel reads the `auth_token`, `refresh_token`
> and `user_role` **cookies**, not localStorage. The real helpers already exist in
> `apps/admin-panel-e2e/src/support/commands.ts` (`cy.apiLogin`, `cy.loginAsSuperAdmin`, `cy.loginViaUi`,
> `cy.createAdminAccount`, `cy.rootToken`, `cy.apiAs`) and `cypress.config.ts` (tasks `resetThrottle`, `totp`, `totpAhead`).
> Ports are not fixed to 3000/4200: pass them through the environment, e.g. for the Phase 5 stack
> `CYPRESS_BASE_URL=http://127.0.0.1:4105 CYPRESS_API_URL=http://localhost:3105/api CYPRESS_ADMIN_EMAIL=... CYPRESS_ADMIN_PASSWORD=...
> CYPRESS_VENDOR_ADMIN_EMAIL=... CYPRESS_VENDOR_ADMIN_PASSWORD=... CYPRESS_REDIS_CONTAINER=wscrm-redis-p5` (unset `ELECTRON_RUN_AS_NODE` first).

```typescript
Cypress.Commands.add('loginAsSuperAdmin', () => {
  cy.session('super-admin', () => {
    cy.apiLogin(Cypress.env('adminEmail'), Cypress.env('adminPassword')).then((b) =>
      cy.setSessionCookies({ auth: b.access_token, refresh: b.refresh_token, role: b.user.role }),
    );
  });
});
```

---

## TST-E2E-013: AP admin login and vendor creation E2E

**Priority:** P0 Critical
**Type:** E2E

### File to Create
`apps/admin-panel-e2e/src/e2e/auth-and-vendors.cy.ts`

> Read the existing test file path in `apps/admin-panel-e2e/` first. If the directory structure uses `cypress/e2e/`, create the file there instead.

### Tasks

#### Task 1: Read existing admin-panel E2E structure
**Action:** List files in `apps/admin-panel-e2e/` to find the correct directory for spec files. Read the cypress config for baseUrl.

#### Task 2: Write auth and vendor creation E2E
**Action:** Create the spec file at the path determined in Task 1:

```typescript
describe('Admin Panel Auth', () => {
  it('should redirect to login when not authenticated', () => {
    cy.visit('/dashboard');
    cy.url().should('include', '/auth/login');
  });

  it('should login as super admin and see the dashboard', () => {
    cy.visit('/auth/login');

    cy.get('input[type="email"]').type(Cypress.env('adminEmail'));
    cy.get('input[type="password"]').type(Cypress.env('adminPassword'));
    cy.get('button[type="submit"]').click();

    cy.url().should('include', '/dashboard');
    cy.get('h1, h2').should('be.visible');
  });
});

describe('Admin Panel — Vendor Management', () => {
  beforeEach(() => {
    cy.loginAsAdmin(Cypress.env('adminEmail'), Cypress.env('adminPassword'));
    cy.visit('/dashboard/vendors');
  });

  it('should display vendors list page', () => {
    cy.get('h1, h2').should('contain.text', /vendors/i);
    cy.get('table, [role="table"]').should('be.visible');
  });

  it('should open Add Vendor form when Add Vendor button is clicked', () => {
    cy.contains('button', /add vendor/i).click();
    cy.get('[role="dialog"]').should('be.visible');
    cy.get('input[name="name"], input[placeholder*="name"]').should('be.visible');
  });

  it('should create a new vendor and see it in the list', () => {
    const uniqueName = `Test Vendor ${Date.now()}`;
    const uniqueEmail = `vendor${Date.now()}@test.com`;

    cy.contains('button', /add vendor/i).click();

    cy.get('input[name="name"]').type(uniqueName);
    cy.get('input[name="email"]').type(uniqueEmail);
    cy.get('input[name="phone"]').type('03001234567');

    cy.contains('button', /save|create|submit/i).click();

    cy.get('[role="dialog"]').should('not.exist');
    cy.contains(uniqueName).should('be.visible');
  });
});
```

### Acceptance Criteria
- [ ] File exists with 5 test cases
- [ ] New vendor appears in list after creation (uses unique timestamp name)
- [ ] All tests pass: `npx nx e2e admin-panel-e2e --spec=src/e2e/auth-and-vendors.cy.ts`

---

## TST-E2E-014: AP vendor enable/disable E2E

**Priority:** P1 High
**Type:** E2E

### File to Create
`apps/admin-panel-e2e/src/e2e/vendor-toggle.cy.ts`

### Tasks

#### Task 1: Read VendorList toggle implementation
**Action:** Read `apps/admin-panel/src/features/vendors/components/vendor-list.tsx`
Note:
- How the active/inactive toggle is rendered (switch, button, or dropdown)
- What text or attribute changes when toggled

#### Task 2: Write vendor toggle E2E
**Action:** Create `apps/admin-panel-e2e/src/e2e/vendor-toggle.cy.ts`

```typescript
describe('Admin Panel — Vendor Toggle Active', () => {
  beforeEach(() => {
    cy.loginAsAdmin(Cypress.env('adminEmail'), Cypress.env('adminPassword'));
    cy.visit('/dashboard/vendors');
  });

  it('should disable an active vendor by clicking its toggle', () => {
    // Find a vendor that is currently active
    cy.get('table tbody tr').first().within(() => {
      // Click the toggle button/switch
      cy.get('[role="switch"][data-state="checked"], button[data-state="checked"]').click();
    });

    // Assert success toast
    cy.get('[data-sonner-toast], [role="alert"]').should('contain.text', /disabled|deactivated|updated/i);
  });

  it('should re-enable a disabled vendor by clicking its toggle', () => {
    // Find a vendor that is currently inactive
    cy.get('table tbody tr').within(($rows) => {
      // Look for a row with inactive/disabled badge
      cy.wrap($rows).contains(/inactive|disabled/i).parents('tr').within(() => {
        cy.get('[role="switch"], button[aria-label*="enable"]').click();
      });
    });

    cy.get('[data-sonner-toast], [role="alert"]').should('contain.text', /enabled|activated|updated/i);
  });
});
```

### Acceptance Criteria
- [ ] File exists with 2 test cases
- [ ] Toggle action is followed by success toast assertion
- [ ] All tests pass

---

## TST-E2E-015: AP product management E2E

**Priority:** P2 Medium
**Type:** E2E

### File to Create
`apps/admin-panel-e2e/src/e2e/products.cy.ts`

### Tasks

**Action:** Create `apps/admin-panel-e2e/src/e2e/products.cy.ts`

Write 3 test cases:

1. `it('should display products list page')`
   - Login as admin
   - Visit `/dashboard/products`
   - Assert table visible with at least one product

2. `it('should open Add Product form and create a product')`
   - Click Add Product
   - Fill name (unique) and basePrice
   - Submit
   - Assert new product appears in list

3. `it('should open edit form for an existing product and update the price')`
   - Click Edit on the first product
   - Change the basePrice value
   - Save
   - Assert updated price is visible in the table

### Acceptance Criteria
- [ ] File exists with 3 test cases
- [ ] Create test uses unique product name
- [ ] All tests pass: `npx nx e2e admin-panel-e2e --spec=src/e2e/products.cy.ts`
