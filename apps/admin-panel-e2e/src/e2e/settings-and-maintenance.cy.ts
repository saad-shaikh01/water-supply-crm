/**
 * Phase 5 - global settings and maintenance mode. Runs against the real API + admin panel.
 * Settings are reset to their defaults after every test.
 */
const apiUrl = () => Cypress.env('apiUrl') as string;
const stamp = Date.now();
const VENDOR_PW = `Vend0r${stamp}!`;

const vendorToken = () => {
  cy.task('resetThrottle', null, { log: false });
  return cy.apiLogin(Cypress.env('vendorAdminEmail'), Cypress.env('vendorAdminPassword')).then((b) => b.access_token as string);
};

describe('settings and maintenance', () => {
  beforeEach(() => cy.loginAsSuperAdmin());
  afterEach(() => cy.resetPlatformSettings());

  it('1. /settings loads and the sidebar link is active', () => {
    cy.visit('/settings');
    cy.get('h1').should('contain.text', 'Settings');
    cy.get('nav a[href="/settings"]').should('have.attr', 'aria-current', 'page');
    cy.get('a[href="/settings/admins"]').should('exist');
    cy.get('a[href="/settings/security"]').should('exist');
  });

  it('2. a toggle persists after reload (feature flags list is empty until a flag is registered)', () => {
    cy.visit('/settings');
    cy.get('[role="tab"]').contains('Feature flags').click();
    cy.contains('No feature flags are defined yet.').should('be.visible');
    cy.get('[role="tab"]').contains('Defaults').click();
    cy.contains(/newly created vendors only/i).should('be.visible');
    cy.get('[role="switch"][aria-label="Enable customer grouping"]').should('have.attr', 'aria-checked', 'false').click();
    cy.get('[role="switch"][aria-label="Enable customer grouping"]').should('have.attr', 'aria-checked', 'true');
    cy.reload();
    cy.get('[role="tab"]').contains('Defaults').click();
    cy.get('[role="switch"][aria-label="Enable customer grouping"]').should('have.attr', 'aria-checked', 'true');
  });

  it('3. maintenance ON with message and ETA: banner shows in the panel and the admin keeps working', () => {
    cy.visit('/settings');
    cy.get('[role="switch"][aria-label="Maintenance mode"]').click();
    cy.get('#maintenance-message').type('Database upgrade in progress');
    cy.get('#maintenance-eta').type('2030-01-01T10:00');
    cy.contains('button', 'Turn maintenance ON').click();
    cy.get('[data-testid="maintenance-banner"]').should('contain.text', 'Maintenance mode is ON');
    cy.visit('/vendors');
    cy.get('h1').should('contain.text', 'Vendors');
    cy.get('[data-testid="maintenance-banner"]').should('be.visible');
    cy.get('table tbody tr').should('have.length.at.least', 1);
  });

  it('4. non-admin API traffic gets 503 MAINTENANCE_MODE; status, login of admins and health stay reachable', () => {
    vendorToken().then((vToken) => {
      cy.apiAs(vToken, 'GET', '/customers').its('status').should('not.eq', 503); // works before maintenance
      cy.rootToken().then((root) =>
        cy
          .apiAs(root, 'PATCH', '/platform-settings', {
            'maintenance.enabled': true,
            'maintenance.message': 'Planned downtime',
            'maintenance.eta': '2030-01-01T10:00:00.000Z',
          })
          .its('status')
          .should('eq', 200),
      );

      cy.apiAs(vToken, 'GET', '/customers').then((res) => {
        expect(res.status).to.eq(503);
        expect(res.body.code).to.eq('MAINTENANCE_MODE');
        expect(res.body.message).to.eq('Planned downtime');
        expect(res.headers).to.have.property('retry-after');
      });

      // public status endpoint: no auth, only public keys
      cy.request(`${apiUrl()}/platform/status`).then((res) => {
        expect(res.body.maintenance).to.deep.include({ enabled: true, message: 'Planned downtime' });
        expect(res.headers['cache-control']).to.contain('no-store');
        expect(JSON.stringify(res.body)).not.to.contain('security.');
      });

      // a vendor admin sign-in sees the notice; a platform admin still signs in
      cy.task('resetThrottle', null, { log: false });
      cy.request({
        method: 'POST',
        url: `${apiUrl()}/auth/login`,
        body: { identifier: Cypress.env('vendorAdminEmail'), password: Cypress.env('vendorAdminPassword') },
        failOnStatusCode: false,
      }).then((res) => {
        expect(res.status).to.eq(503);
        expect(res.body.code).to.eq('MAINTENANCE_MODE');
      });
      cy.rootToken().should('be.a', 'string');

      // health is exempt from the guard (it may answer 500 on Windows for unrelated reasons, but never 503)
      cy.request({ url: `${apiUrl()}/health`, failOnStatusCode: false }).its('status').should('not.eq', 503);
    });
  });

  it('5. the notice carries message and ETA for the vendor and customer apps (gate is covered by component tests)', () => {
    vendorToken().then((vToken) => {
      cy.rootToken().then((root) =>
        cy.apiAs(root, 'PATCH', '/platform-settings', { 'maintenance.enabled': true, 'maintenance.eta': '2030-01-01T10:00:00.000Z', 'maintenance.message': 'Back at ten' }),
      );
      cy.apiAs(vToken, 'GET', '/customers').then((res) => {
        expect(res.status).to.eq(503);
        // exactly what the shared axios interceptor turns into the full-screen MaintenanceGate
        expect(res.body).to.include({ code: 'MAINTENANCE_MODE', message: 'Back at ten' });
        expect(res.body.eta).to.eq('2030-01-01T10:00:00.000Z');
      });
    });
  });

  it('6. turning maintenance OFF restores vendor access within 5 seconds', () => {
    vendorToken().then((vToken) => {
      cy.rootToken().then((root) => {
        cy.apiAs(root, 'PATCH', '/platform-settings', { 'maintenance.enabled': true });
        cy.apiAs(vToken, 'GET', '/customers').its('status').should('eq', 503);
        cy.apiAs(root, 'PATCH', '/platform-settings', { 'maintenance.enabled': false }).its('status').should('eq', 200);
      });
      const started = Date.now();
      const poll = (): Cypress.Chainable<unknown> =>
        cy.apiAs(vToken, 'GET', '/customers').then((res) => {
          if (res.status !== 503) {
            expect(Date.now() - started).to.be.lessThan(5000);
            return;
          }
          expect(Date.now() - started, 'recovered in time').to.be.lessThan(5000);
          return cy.wait(500).then(poll);
        });
      poll();
    });
  });

  it('7. defaults.customerGroupingEnabled applies to NEW vendors only (created through the wizard)', () => {
    const slug = `e2e-p5-${stamp}`;
    let existing: { id: string; customerGroupingEnabled: boolean };

    cy.rootToken().then((root) => {
      cy.apiAs(root, 'GET', '/vendors?limit=1').then((res) => {
        existing = res.body.data[0];
      });
      cy.apiAs(root, 'PATCH', '/platform-settings', { 'defaults.customerGroupingEnabled': true }).its('status').should('eq', 200);
    });

    cy.visit('/vendors');
    cy.contains('button', 'Add Vendor').click();
    cy.get('#wiz-name').type(`E2E P5 ${stamp}`);
    cy.get('#wiz-slug').type(slug);
    cy.contains('button', 'Next').click();
    cy.get('#wiz-admin-name').type('Wizard Admin');
    cy.get('#wiz-admin-email').type(`${slug}@e2e.test`);
    cy.get('#wiz-admin-password').type(VENDOR_PW, { log: false });
    cy.contains('button', 'Next').click();
    cy.contains('button', 'Create Vendor').click();
    cy.get('[aria-label="Provisioning summary"]', { timeout: 30000 }).should('be.visible');

    cy.rootToken().then((root) => {
      cy.apiAs(root, 'GET', `/vendors?search=${slug}`).then((res) => {
        const created = res.body.data.find((v: { slug: string }) => v.slug === slug);
        expect(created, 'new vendor').to.not.equal(undefined);
        cy.apiAs(root, 'GET', `/vendors/${created.id}`).its('body.customerGroupingEnabled').should('eq', true);
        // cleanup: the throwaway vendor
        cy.apiAs(root, 'DELETE', `/vendors/${created.id}`);
      });
      cy.apiAs(root, 'GET', `/vendors/${existing.id}`).its('body.customerGroupingEnabled').should('eq', existing.customerGroupingEnabled);
    });
  });
});
