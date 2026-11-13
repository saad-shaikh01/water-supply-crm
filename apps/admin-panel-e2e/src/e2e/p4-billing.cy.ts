/**
 * Phase 4 billing e2e against the REAL API (no stubs): plans, subscriptions, invoices.
 * Every test creates its own uniquely named plan/vendor so the suite is re-runnable on a used DB.
 */
export {};
const uniq = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 4)}`;

function createPlan(name: string, extra: Record<string, unknown> = {}) {
  return cy
    .adminApi('POST', '/platform/plans', { name, price: 1000, interval: 'MONTHLY', trialDays: 7, maxCustomers: 5, maxDrivers: 2, maxVans: 1, ...extra })
    .then((r) => r.body as { id: string; name: string });
}

function pickVendorInDialog(name: string, selectId: string) {
  cy.get('[role="dialog"]').within(() => {
    cy.get('input[aria-label="Search vendor"]').type(name.slice(0, 20));
    cy.get(`#${selectId}`).select(name);
  });
}

describe('Phase 4: billing', () => {
  beforeEach(() => cy.loginAsSuperAdmin());

  it('1. plans: validation, create with limits, edit, deactivate, unlimited shown', () => {
    const name = `Starter ${uniq()}`;
    cy.visit('/billing?tab=plans');
    cy.contains('button', 'New plan').click();

    // empty submit -> field errors, nothing created
    cy.get('[role="dialog"]').contains('button', 'Create plan').click();
    cy.get('[role="dialog"]').should('contain.text', 'Name is required').and('contain.text', 'Enter a price');
    cy.get('#plan-name').type(name);
    cy.get('#plan-price').type('-5');
    cy.get('#plan-max-customers').type('-1');
    cy.get('[role="dialog"]').contains('button', 'Create plan').click();
    cy.get('[role="dialog"]').should('contain.text', 'Enter a price').and('contain.text', 'Whole number or empty');

    cy.get('#plan-price').clear().type('2500');
    cy.get('#plan-max-customers').clear().type('5');
    cy.get('#plan-max-drivers').type('2');
    cy.get('#plan-max-vans').type('1');
    cy.get('#plan-trial').type('14');
    cy.get('[role="dialog"]').contains('button', 'Create plan').click();
    cy.get('[role="dialog"]').should('not.exist');

    cy.contains('tr', name).within(() => {
      cy.contains('Rs.').should('not.exist'); // currency is PKR
      cy.contains('PKR 2,500 / monthly');
      cy.contains('14 days');
      cy.contains('Active');
    });

    // duplicate name -> API conflict surfaced, dialog stays open
    cy.contains('button', 'New plan').click();
    cy.get('#plan-name').type(name);
    cy.get('#plan-price').type('1');
    cy.get('[role="dialog"]').contains('button', 'Create plan').click();
    cy.contains(/already exists/i);
    cy.get('[role="dialog"]').contains('button', 'Cancel').click();

    // edit: raise customers, clear vans to unlimited
    cy.contains('tr', name).find(`button[aria-label="Edit ${name}"]`).click();
    cy.get('#plan-max-customers').clear().type('8');
    cy.get('#plan-max-vans').clear();
    cy.get('[role="dialog"]').contains('button', 'Save changes').click();
    cy.get('[role="dialog"]').should('not.exist');
    cy.contains('tr', name).within(() => {
      cy.contains('td', /^8$/);
      cy.contains('td', 'Unlimited');
    });

    // deactivate
    cy.contains('tr', name).find(`button[aria-label="Deactivate ${name}"]`).click();
    cy.contains('tr', name).should('contain.text', 'Inactive');
    cy.contains('tr', name).find(`button[aria-label="Activate ${name}"]`).should('exist');
  });

  it('2. subscriptions: assign (trial + usage bars), change plan, cancel with reason, reactivate', () => {
    const a = `Starter ${uniq()}`;
    const b = `Growth ${uniq()}`;
    createPlan(a);
    createPlan(b, { price: 5000, maxCustomers: null, maxDrivers: null, maxVans: null });
    cy.createTestVendor('sub').then((vendor) => {
      cy.visit('/billing?tab=subscriptions');
      cy.contains('button', 'Assign plan').click();

      // validation first
      cy.get('[role="dialog"]').contains('button', 'Save subscription').click();
      cy.get('[role="dialog"]').should('contain.text', 'Select a vendor').and('contain.text', 'Select a plan');

      pickVendorInDialog(vendor.name, 'sub-vendor');
      cy.get('#sub-plan').select(a);
      cy.get('[role="dialog"]').contains('button', 'Save subscription').click();
      cy.get('[role="dialog"]').should('not.exist');

      cy.get('input[aria-label="Search vendors"]').type(vendor.name);
      cy.contains('tr', vendor.name).within(() => {
        cy.get('[data-status="TRIAL"]').should('exist');
        cy.contains(a);
        cy.get('[data-testid="usage-bars"]').should('exist');
        cy.get('[data-testid="usage-customers"]').should('contain.text', '/ 5');
        cy.get('[data-testid="usage-vans"]').should('contain.text', '/ 1');
        cy.contains('button', 'Manage').click();
      });

      // detail dialog: change plan to unlimited
      cy.get('[data-testid="vendor-subscription"]').should('contain.text', a);
      cy.contains('button', 'Change plan / overrides').click();
      cy.get('#sub-plan').select(b);
      cy.contains('button', 'Save subscription').click();
      cy.get('[data-testid="vendor-subscription"]').should('contain.text', b);
      cy.get('[data-testid="usage-customers"]').should('contain.text', 'Unlimited');

      // cancel requires a reason
      cy.contains('button', 'Cancel subscription').click();
      cy.get('[role="dialog"]').last().contains('button', 'Cancel subscription').click();
      cy.contains('A reason is required');
      cy.get('#cancel-reason').type('Vendor requested cancellation');
      cy.get('[role="dialog"]').last().contains('button', 'Cancel subscription').click();
      cy.get('[data-testid="vendor-subscription"] [data-status="CANCELLED"]').should('exist');
      cy.get('[data-testid="vendor-subscription"]').should('contain.text', 'Vendor requested cancellation');

      cy.contains('button', 'Reactivate').click();
      cy.get('[data-testid="vendor-subscription"] [data-status="ACTIVE"]').should('exist');
    });
  });

  it('3. subscriptions: assigning a plan below current usage warns and flags the vendor over limit', () => {
    const tiny = `Tiny ${uniq()}`;
    const roomy = `Roomy ${uniq()}`;
    createPlan(tiny, { maxCustomers: 0, maxDrivers: 0, maxVans: 0, trialDays: 0 });
    createPlan(roomy, { maxCustomers: null, maxDrivers: null, maxVans: null, trialDays: 0 });
    // a seeded vendor that already has customers (real usage)
    cy.adminApi('GET', '/vendors?limit=1&sort=customers&order=desc').then((res) => {
      const vendor = res.body.data[0] as { id: string; name: string };
      expect(res.body.data[0]._counts.customers, 'seeded vendor with customers').to.be.greaterThan(0);
      {
        cy.visit('/billing?tab=subscriptions');
        cy.contains('button', 'Assign plan').click();
        pickVendorInDialog(vendor.name, 'sub-vendor');
        cy.get('#sub-plan').select(tiny);
        cy.get('[role="dialog"]').contains('button', 'Save subscription').click();
        cy.contains(/over the limits of this plan/i);
        cy.get('input[aria-label="Search vendors"]').type(vendor.name);
        cy.contains('tr', vendor.name).within(() => {
          cy.contains('Over limit');
          cy.get('[data-over="true"]').should('exist');
        });
        // restore the vendor to an unlimited plan (limits must not leak into other suites)
        cy.adminApi('GET', '/platform/plans?includeInactive=true').then((r) => {
          const p = (r.body as { id: string; name: string }[]).find((x) => x.name === roomy);
          cy.adminApi('PUT', `/platform/vendors/${vendor.id}/subscription`, { planId: p?.id });
        });
      }
    });
  });

  it('4. invoices: create, partial then full payment -> PAID and subscription ACTIVE; void blocked after payment; overdue badge', () => {
    const plan = `Inv ${uniq()}`;
    createPlan(plan);
    cy.createTestVendor('inv').then((vendor) => {
      cy.adminApi('GET', '/platform/plans?includeInactive=true').then((r) => {
        const p = (r.body as { id: string; name: string }[]).find((x) => x.name === plan);
        cy.adminApi('PUT', `/platform/vendors/${vendor.id}/subscription`, { planId: p?.id, startTrial: true }).then((sub) => {
          expect(sub.body.subscription.status).to.eq('TRIAL');
          const subscriptionId = sub.body.subscription.id as string;

          // subscription-linked OPEN invoice via API so the PAID side effect applies
          cy.adminApi('POST', '/platform/invoices', { vendorId: vendor.id, amount: 1000, dueAt: new Date(Date.now() + 7 * 864e5).toISOString(), subscriptionId, description: 'e2e subscription' }).then((inv) => {
            const number = inv.body.number as string;
            cy.visit('/billing?tab=invoices');
            cy.get('input[aria-label="Search vendor"]').first().type(vendor.name.slice(0, 20));
            cy.get('#invoice-filter-vendor').select(vendor.name);
            cy.contains('tr', number).within(() => {
              cy.get('[data-status="OPEN"]').should('exist');
              cy.contains('button', 'Record payment').click();
            });

            // overpayment blocked client side; nothing sent
            cy.get('[data-testid="payment-remaining"]').should('contain.text', 'Remaining balance PKR 1,000');
            cy.get('#pay-amount').type('1500');
            cy.get('[role="dialog"]').contains('button', 'Record payment').click();
            cy.get('[role="dialog"]').should('contain.text', 'exceeds the remaining balance');

            // partial payment
            cy.get('#pay-amount').clear().type('400');
            cy.get('#pay-method').select('RAAST');
            cy.get('#pay-ref').type('RAAST-123');
            cy.get('[role="dialog"]').contains('button', 'Record payment').click();
            cy.get('[role="dialog"]').should('not.exist');
            cy.contains('tr', number).find('[data-status="OPEN"]').should('exist');

            // void blocked now that a payment exists (server 409 surfaced)
            cy.contains('tr', number).find(`button[aria-label="Void ${number}"]`).click();
            cy.get('#void-reason').type('mistake');
            cy.get('[role="dialog"]').contains('button', 'Void invoice').click();
            cy.contains(/cannot be voided/i);
            cy.get('[role="dialog"]').contains('button', 'Cancel').click();

            // remaining 600 then settle
            cy.contains('tr', number).find('button[aria-label^="Record payment"]').click();
            cy.get('[data-testid="payment-remaining"]').should('contain.text', 'Remaining balance PKR 600');
            cy.get('#pay-amount').type('600');
            cy.get('[role="dialog"]').contains('button', 'Record payment').click();
            cy.get('[role="dialog"]').should('not.exist');
            cy.contains('tr', number).find('[data-status="PAID"]').should('exist');
            cy.contains('tr', number).find('button[aria-label^="Record payment"]').should('not.exist');

            // subscription is now ACTIVE (real API)
            cy.adminApi('GET', `/platform/vendors/${vendor.id}/subscription`).its('body.subscription.status').should('eq', 'ACTIVE');
          });
        });
      });
    });
  });

  it('5. invoices: create via UI (validation, draft -> issue), overdue badge, void', () => {
    cy.createTestVendor('inv2').then((vendor) => {
      cy.visit('/billing?tab=invoices');
      cy.contains('button', 'Create invoice').click();
      cy.get('[role="dialog"]').contains('button', 'Create invoice').click();
      cy.get('[role="dialog"]').should('contain.text', 'Select a vendor').and('contain.text', 'Enter an amount');

      pickVendorInDialog(vendor.name, 'inv-vendor');
      cy.get('#inv-amount').type('0');
      cy.get('[role="dialog"]').contains('button', 'Create invoice').click();
      cy.get('[role="dialog"]').should('contain.text', 'Enter an amount');
      cy.get('#inv-amount').clear().type('750.50');
      cy.get('#inv-due').clear().type('2020-01-15'); // in the past -> derived Overdue once OPEN
      cy.get('#inv-desc').type('Manual setup fee');
      cy.get('#inv-draft').check();
      cy.get('[role="dialog"]').contains('button', 'Create invoice').click();
      cy.get('[role="dialog"]').should('not.exist');

      cy.get('input[aria-label="Search vendor"]').first().type(vendor.name.slice(0, 20));
      cy.get('#invoice-filter-vendor').select(vendor.name);
      cy.get('table tbody tr').should('have.length', 1).first().within(() => {
        cy.get('[data-status="DRAFT"]').should('exist');
        cy.contains('PKR 750.5');
        cy.contains('button', 'Issue').click();
      });
      cy.get('table tbody tr').first().find('[data-status="OVERDUE"]').should('contain.text', 'Overdue');

      // void with reason (no payments) succeeds
      cy.get('table tbody tr').first().find('button[aria-label^="Void"]').click();
      cy.get('[role="dialog"]').contains('button', 'Void invoice').click();
      cy.contains('A reason is required');
      cy.get('#void-reason').type('Created in error');
      cy.get('[role="dialog"]').contains('button', 'Void invoice').click();
      cy.get('table tbody tr').first().find('[data-status="VOID"]').should('exist');

      // status filter drives the request
      cy.get('select[aria-label="Filter by status"]').select('PAID');
      cy.contains('No invoices');
    });
  });
});
