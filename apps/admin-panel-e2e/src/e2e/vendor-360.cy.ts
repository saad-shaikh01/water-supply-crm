/**
 * Phase 2 - Vendor 360. Runs against the real API + admin panel.
 * Fixtures are created through the API with a unique `e2e-<timestamp>` prefix and removed in `after`.
 */
const stamp = Date.now();
const P = `e2e-${stamp}`;
const apiUrl = () => Cypress.env('apiUrl') as string;
const VENDOR_PW = `Vend0r${stamp}!`;
const NEW_PW = `N3wPass${stamp}x`;

type Fx = { id: string; slug: string; name: string; email: string };
const fx: Record<string, Fx> = {};
const extraIds: string[] = [];
const FILLERS = 11; // guarantees > 10 vendors so page 2 exists at limit 10

const superToken = () => {
  cy.task('resetThrottle', null, { log: false });
  return cy.apiLogin(Cypress.env('adminEmail'), Cypress.env('adminPassword')).then((b) => b.access_token as string);
};

const createVendor = (key: string, token: string) => {
  const slug = `${P}-${key}`;
  const email = `${slug}@e2e.test`;
  return cy
    .request({
      method: 'POST',
      url: `${apiUrl()}/vendors`,
      headers: { Authorization: `Bearer ${token}` },
      body: { name: `E2E ${stamp} ${key}`, slug, adminEmail: email, adminPassword: VENDOR_PW, adminName: `Admin ${key}` },
    })
    .then((res) => {
      expect(res.status).to.eq(201);
      fx[key] = { id: res.body.vendor.id, slug, name: `E2E ${stamp} ${key}`, email };
    });
};

const vendorLogin = (email: string, password: string) => {
  cy.task('resetThrottle', null, { log: false });
  return cy.request({ method: 'POST', url: `${apiUrl()}/auth/login`, body: { identifier: email, password }, failOnStatusCode: false });
};

const authed = (token: string, method: string, path: string, body?: Record<string, unknown>) =>
  cy.request({ method, url: `${apiUrl()}${path}`, headers: { Authorization: `Bearer ${token}` }, body, failOnStatusCode: false });

describe('Vendor 360', () => {
  before(() => {
    superToken().then((t) => {
      ['main', 'susp', 'reset', 'bulk1', 'bulk2', 'bulk3', 'bulkpre'].forEach((k) => createVendor(k, t));
      cy.then(() => authed(t, 'PATCH', `/vendors/${fx['bulkpre'].id}/suspend`, { reason: 'e2e pre-suspended' }));
      // fillers so that the list has more than one page at limit 10
      authed(t, 'GET', '/vendors?limit=1').then((res) => {
        const total = res.body.meta.total as number;
        const need = Math.max(0, FILLERS - total);
        for (let i = 0; i < need; i++) {
          const slug = `${P}-fill${i}`;
          cy.request({
            method: 'POST',
            url: `${apiUrl()}/vendors`,
            headers: { Authorization: `Bearer ${t}` },
            body: { name: `E2E ${stamp} fill${i}`, slug, adminEmail: `${slug}@e2e.test`, adminPassword: VENDOR_PW, adminName: 'Filler' },
          }).then((r) => {
            extraIds.push(r.body.vendor.id);
          });
        }
      });
    });
  });

  // The dev server compiles each route on first hit (slow); warm the pages up so test timeouts measure the app.
  before(() => {
    cy.loginAsSuperAdmin();
    cy.visit('/vendors', { timeout: 120000 });
    cy.get('table', { timeout: 60000 }).should('exist');
    cy.visit(`/vendors/${fx['main'].id}`, { timeout: 120000 });
    cy.contains('h1', fx['main'].name, { timeout: 60000 });
    ['users', 'readiness', 'branding', 'activity'].forEach((tab) => {
      cy.contains('[role="tab"]', new RegExp(tab, 'i')).click();
    });
  });

  after(() => {
    superToken().then((t) => {
      Object.values(fx).forEach((v) => authed(t, 'DELETE', `/vendors/${v.id}`));
      extraIds.forEach((id) => authed(t, 'DELETE', `/vendors/${id}`));
      // vendors created through the wizard
      authed(t, 'GET', `/vendors?search=${P}-wiz&limit=50`).then((r) => {
        (r.body.data ?? []).forEach((v: { id: string }) => authed(t, 'DELETE', `/vendors/${v.id}`));
      });
    });
  });

  beforeEach(() => cy.loginAsSuperAdmin());

  it('1. list: search, suspended filter, sort, page 2, filters survive reload', () => {
    cy.intercept('GET', '**/api/vendors?*').as('list');
    cy.visit('/vendors');
    cy.wait('@list');

    // search narrows to the one matching vendor
    cy.get('input[aria-label="Search vendors"]').type(`${P}-main`);
    cy.wait('@list').its('request.url').should('include', `search=${P}-main`);
    cy.get('table tbody tr').should('have.length', 1).and('contain.text', fx['main'].name);

    // suspended filter (only the pre-suspended bulk fixture carries the prefix)
    cy.get('input[aria-label="Search vendors"]').clear().type(`${P}-bulk`);
    cy.get('select[aria-label="Filter by status"]').select('suspended');
    cy.get('table tbody tr').should('have.length', 1).and('contain.text', fx['bulkpre'].name);
    cy.contains('table tbody tr', fx['bulkpre'].name).contains('Suspended');

    // sort by name, ascending then descending
    cy.get('select[aria-label="Filter by status"]').select('all');
    cy.get('input[aria-label="Search vendors"]').clear().type(`${P}-bulk`);
    cy.get('table tbody tr').should('have.length.at.least', 3);
    cy.get('button[aria-label="Sort by vendor"]').click();
    cy.url().should('include', 'sort=name').and('include', 'order=asc');
    cy.get("table tbody tr").first().should("contain.text", fx["bulk1"].name);
    cy.get('button[aria-label="Sort by vendor"]').click();
    cy.url().should('not.include', 'order=asc'); // desc is the default, so it leaves the URL
    cy.get("table tbody tr").first().should("contain.text", fx["bulkpre"].name);

    // page 2 at limit 10
    cy.visit('/vendors?limit=10&page=2');
    cy.get('table tbody tr').should('have.length.at.least', 1);
    cy.contains(/Showing\s*11/).should('exist');

    // filters survive a reload
    cy.visit(`/vendors?q=${P}-main&status=active&sort=name&order=asc`);
    cy.get('table tbody tr').should('have.length', 1);
    cy.reload();
    cy.get('input[aria-label="Search vendors"]').should('have.value', `${P}-main`);
    cy.get('select[aria-label="Filter by status"]').should('have.value', 'active');
    cy.get('table tbody tr').should('have.length', 1);
  });

  it('2. wizard: 3 steps, provisioning summary, Open vendor -> readiness tab; duplicate slug stays on step 1', () => {
    const slug = `${P}-wiz${Cypress.currentRetry}`;
    const fill = (name: string, s: string, email: string) => {
      cy.contains('button', 'Add Vendor').click();
      cy.get('#wiz-name').type(name);
      cy.get('#wiz-slug').type(s);
      cy.contains('button', 'Next').click();
      cy.get('#wiz-admin-name').type('Wizard Admin');
      cy.get('#wiz-admin-email').type(email);
      cy.get('#wiz-admin-password').type(VENDOR_PW, { log: false });
      cy.contains('button', 'Next').click();
      cy.contains('Review').should('exist');
    };

    cy.visit('/vendors');
    fill(`E2E ${stamp} wiz`, slug, `${slug}@e2e.test`);
    cy.contains('button', 'Create Vendor').click();
    cy.get('[aria-label="Provisioning summary"]', { timeout: 20000 }).should('be.visible').find('li').should('have.length.at.least', 1);
    cy.contains('button', 'Open vendor').click();
    cy.location('pathname', { timeout: 60000 }).should('match', /^\/vendors\/[0-9a-f-]{36}$/);
    cy.location('search').should('eq', '?tab=readiness');
    cy.get('[aria-label="Readiness checklist"] li', { timeout: 30000 }).should('have.length', 7);

    // duplicate slug -> back on step 1 with the API message
    cy.visit('/vendors');
    fill(`E2E ${stamp} wiz2`, slug, `${slug}-2@e2e.test`);
    cy.contains('button', 'Create Vendor').click();
    cy.contains(/slug already exists|slug or admin email already exists/i, { timeout: 15000 }).should('be.visible');
    cy.get('#wiz-slug').should('have.value', slug);
    cy.get('#wiz-admin-name').should('not.exist');
  });

  it('3. detail tabs: overview, users, readiness, branding flips an item to DONE, activity', () => {
    const v = fx['main'];
    superToken().then((t) => authed(t, 'PATCH', `/vendors/${v.id}`, { address: 'E2E Street 1' }));

    cy.visit(`/vendors/${v.id}`);
    cy.contains('h1', v.name);
    cy.contains('Customers').should('be.visible');
    cy.get('[data-stat="Customers"]').should('have.text', '0');

    cy.contains('[role="tab"]', 'Users').click();
    cy.url().should('include', 'tab=users');
    cy.contains('td', v.email).should('be.visible');
    cy.get('tbody tr').should('have.length', 1); // admin only; customers are hidden by default
    cy.contains('button', /^Customers/).should('have.attr', 'aria-pressed', 'false');

    cy.contains('[role="tab"]', 'Readiness').click();
    cy.get('[aria-label="Readiness checklist"] li').should('have.length', 7);
    cy.get('li[data-item="company_profile"]').should('have.attr', 'data-status', 'TODO');

    cy.contains('[role="tab"]', 'Branding').click();
    cy.get('#br-displayName').should('not.have.value', '');
    cy.get('#br-address').clear().type('E2E Street 1');
    cy.get('#br-phones').clear().type('0300-1234567');
    cy.contains('button', 'Add account').click();
    cy.get('#pa-0-title').type('E2E Water');
    cy.get('#pa-0-number').type('1234-5678-90');
    cy.get('#pa-0-bank').type('HBL');
    cy.intercept('PUT', '**/branding').as('saveBranding');
    cy.contains('button', 'Save branding').click();
    cy.wait('@saveBranding').its('response.statusCode').should('eq', 200);

    cy.contains('[role="tab"]', 'Readiness').click();
    cy.get('li[data-item="company_profile"]').should('have.attr', 'data-status', 'DONE');
    cy.get('li[data-item="payment_accounts"]').should('have.attr', 'data-status', 'DONE');

    cy.contains('[role="tab"]', 'Activity').click();
    cy.contains('td', 'CREATE').should('exist');
    cy.contains('td', 'UPDATE').should('exist');
  });

  it('4. suspend / unsuspend from the header flips the badge and blocks the vendor admin immediately', () => {
    const v = fx['susp'];
    superToken().then((t) => authed(t, 'PATCH', `/vendors/${v.id}/unsuspend`, {})); // retry-safe starting state
    cy.visit(`/vendors/${v.id}`);
    cy.contains('h1', v.name).parent().contains('Active');

    cy.contains('button', /^\s*Suspend/).click();
    cy.get('[role="dialog"]').contains('button', 'Suspend').click();
    cy.contains('h1', v.name).parent().contains('Suspended');
    vendorLogin(v.email, VENDOR_PW).then((r) => {
      expect(r.status).to.eq(401); // the API refuses suspended vendors at login (Unauthorized)
      expect(JSON.stringify(r.body)).to.match(/suspended/i);
    });

    cy.contains('button', /Unsuspend/).click();
    cy.contains('h1', v.name).parent().contains('Active');
    vendorLogin(v.email, VENDOR_PW).its('status').should('be.oneOf', [200, 201]);
  });

  it('5. go live: disabled with open items, forced with the typed slug, take offline reverts, activity lists both', () => {
    const v = fx['main'];
    cy.visit(`/vendors/${v.id}?tab=readiness`);
    cy.contains('button', /^Go live$/).should('be.disabled');

    cy.contains('button', 'Force go-live').click();
    cy.get('[role="dialog"]').within(() => {
      cy.get('[aria-label="Open items"] li').should('have.length.at.least', 1);
      cy.contains('button', 'Force go-live').should('be.disabled');
      cy.get('#typed-confirm-input').type(v.slug);
      cy.contains('button', 'Force go-live').should('not.be.disabled').click();
    });
    cy.contains('h1', v.name).parent().contains('Live');

    cy.contains('button', 'Take offline').click();
    cy.get('[role="dialog"]').within(() => {
      cy.get('#offline-reason').type('e2e revert');
      cy.contains('button', 'Take offline').click();
    });
    cy.contains('h1', v.name).parent().contains('Setup');

    cy.contains('[role="tab"]', 'Activity').click();
    cy.contains('td', 'GO_LIVE').should('exist');
    cy.contains('td', 'GO_OFFLINE').should('exist');
  });

  it('6. reset password: wrong re-auth is refused, correct flow revokes the old password and leaves no plaintext', () => {
    const v = fx['reset'];
    cy.visit(`/vendors/${v.id}?tab=users`);
    cy.contains('td', v.email).should('be.visible');
    const open = () => cy.get(`button[aria-label="Reset password for ${v.email}"]`).click();
    const fillForm = (superPw: string) => {
      cy.get('#rp-new').type(NEW_PW, { log: false });
      cy.get('#rp-confirm').type(NEW_PW, { log: false });
      cy.get('#rp-super').type(superPw, { log: false });
      cy.get('#rp-reason').type('e2e locked out');
      cy.get('[role="dialog"] input[type="checkbox"]').check();
    };

    // wrong super-admin password
    open();
    fillForm('definitely-wrong-1');
    cy.contains('button', /^Reset password$/).should('not.be.disabled').click();
    cy.get('[role="alert"]').should('contain.text', 'Incorrect password');
    vendorLogin(v.email, VENDOR_PW).its('status').should('be.oneOf', [200, 201]); // old password still works

    // correct flow (same dialog; the super-admin field was cleared)
    cy.get('#rp-super').type(Cypress.env('adminPassword'), { log: false });
    cy.contains('button', /^Reset password$/).should('not.be.disabled').click();
    cy.get('[role="status"]', { timeout: 15000 }).should('contain.text', 'sessions were revoked');
    cy.contains(NEW_PW).should('not.exist');
    cy.contains(Cypress.env('adminPassword')).should('not.exist');
    cy.contains('button', 'Close').click();

    vendorLogin(v.email, VENDOR_PW).its('status').should('eq', 401);
    vendorLogin(v.email, NEW_PW).its('status').should('be.oneOf', [200, 201]);

    cy.contains('[role="tab"]', 'Activity').click();
    cy.contains('td', 'RESET_ADMIN_PASSWORD').should('exist');
    cy.contains('td', 'e2e locked out').should('exist');
    cy.contains(NEW_PW).should('not.exist');
  });

  it('7. repair setup: confirm shows the success summary', () => {
    const v = fx['main'];
    cy.visit(`/vendors/${v.id}`);
    cy.contains('button', /Repair setup/).click();
    cy.get('[role="dialog"]').contains('button', 'Repair setup').click();
    cy.contains('Setup repaired', { timeout: 20000 }).should('be.visible');
    cy.get('[aria-label="Repair summary"] li').should('have.length.at.least', 1);
  });

  it('8. bulk: two vendors suspended after typed confirmation; a pre-suspended one yields a failure row', () => {
    cy.visit(`/vendors?q=${P}-bulk`);
    cy.contains('table tbody tr', fx['bulk1'].name).should('exist');

    cy.get(`input[aria-label="Select ${fx['bulk1'].name}"]`).check();
    cy.get(`input[aria-label="Select ${fx['bulk2'].name}"]`).check();
    cy.get('[role="toolbar"]').within(() => {
      cy.contains('2 selected');
      cy.contains('button', /delete|wipe|reset/i).should('not.exist');
      cy.contains('button', 'Suspend').click();
    });
    cy.get('[role="dialog"]').within(() => {
      cy.contains('button', /^Suspend$/).should('be.disabled');
      cy.get('#typed-confirm-input').type('SUSPEND 2');
      cy.contains('button', /^Suspend$/).should('not.be.disabled').click();
    });
    cy.get('[aria-label="Bulk results"] li[data-result="ok"]').should('have.length', 2);
    cy.contains('[role="dialog"] button', 'Close').click();
    cy.contains('table tbody tr', fx['bulk1'].name).contains('Suspended');
    cy.contains('table tbody tr', fx['bulk2'].name).contains('Suspended');

    // mixed: bulk3 (active) + bulkpre (already suspended)
    cy.get(`input[aria-label="Select ${fx['bulk3'].name}"]`).check();
    cy.get(`input[aria-label="Select ${fx['bulkpre'].name}"]`).check();
    cy.get('[role="toolbar"]').contains('button', 'Suspend').click();
    cy.get('[role="dialog"]').within(() => {
      cy.get('#typed-confirm-input').type('SUSPEND 2');
      cy.contains('button', /^Suspend$/).click();
    });
    cy.get('[aria-label="Bulk results"] li[data-result="failed"]').should('have.length', 1).and('contain.text', fx['bulkpre'].name);
    cy.get('[aria-label="Bulk results"] li[data-result="ok"]').should('have.length', 1);
  });

  it('9. edit vendor name succeeds (no 400), slug is read-only and never sent', () => {
    const v = fx['main'];
    const newName = `E2E ${stamp} main r${Date.now()}`;
    cy.intercept('PATCH', `**/api/vendors/${v.id}`).as('patch');
    cy.visit(`/vendors/${v.id}`);
    cy.contains('button', /^\s*Edit\s*$/).click();
    cy.get('#vendor-slug').should('have.attr', 'readonly');
    cy.get('#vendor-slug').should('have.value', v.slug);
    cy.get('#vendor-name').clear().type(newName);
    cy.contains('button', 'Update').click();
    cy.wait('@patch').then((i) => {
      expect(i.response?.statusCode).to.eq(200);
      expect(i.request.body).to.not.have.property('slug');
      expect(i.request.body).to.deep.include({ name: newName });
    });
    cy.contains('h1', newName);
    fx['main'].name = newName;
  });

  it('10. authorization: a VENDOR_ADMIN token is refused on every vendor mutation', () => {
    const v = fx['reset'];
    // use the seeded vendor admin from the environment (never suspended by this suite)
    cy.apiLogin(Cypress.env('vendorAdminEmail'), Cypress.env('vendorAdminPassword')).then((b) => {
      const t = b.access_token;
      authed(t, 'POST', '/vendors', { name: 'x', slug: 'xx', adminEmail: 'x@x.com', adminPassword: 'abcd1234', adminName: 'x' }).its('status').should('eq', 403);
      authed(t, 'PATCH', `/vendors/${v.id}`, { name: 'hack' }).its('status').should('eq', 403);
      authed(t, 'PATCH', `/vendors/${v.id}/suspend`, {}).its('status').should('eq', 403);
      authed(t, 'DELETE', `/vendors/${v.id}`).its('status').should('eq', 403);
      authed(t, 'POST', '/vendors/bulk/suspend', { vendorIds: [v.id] }).its('status').should('eq', 403);
      authed(t, 'POST', `/vendors/${v.id}/reset-admin-password`, { newPassword: 'abcd1234', superAdminPassword: 'x' }).its('status').should('eq', 403);
      authed(t, 'POST', `/vendors/${v.id}/provision`).its('status').should('eq', 403);
      authed(t, 'GET', '/vendors').its('status').should('eq', 403);
    });
  });
});
