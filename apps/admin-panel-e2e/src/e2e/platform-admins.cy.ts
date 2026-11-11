export {}; // module scope: keeps top-level consts private to this spec
/**
 * Phase 5 - platform administrators page. Runs against the real API + admin panel.
 * Root (the configured SUPER_ADMIN) drives the UI; targets are fresh admins created per scenario.
 */
const apiUrl = () => Cypress.env('apiUrl') as string;
const stamp = Date.now();

describe('platform admins', () => {
  beforeEach(() => cy.loginAsSuperAdmin());
  afterEach(() => cy.resetPlatformSettings());

  it('1. create an admin: the temporary password is shown once and the account is flagged mustChangePassword', () => {
    const email = `third.${stamp}@e2e.test`;
    cy.visit('/settings/admins');
    cy.contains('button', 'Add administrator').click();
    cy.get('#admin-name').type(`Third ${stamp}`);
    cy.get('#admin-email').type(email);
    cy.contains('button', 'Create administrator').click();
    cy.get('[data-testid="temp-password"]', { timeout: 15000 })
      .invoke('text')
      .then((tempPassword) => {
        expect(tempPassword.length).to.be.greaterThan(11);
        cy.contains('button', 'Done').click();
        cy.get('[data-testid="temp-password"]').should('not.exist'); // gone once closed
        cy.task('resetThrottle', null, { log: false });
        cy.request({ method: 'POST', url: `${apiUrl()}/auth/login`, body: { identifier: email, password: tempPassword.trim() } }).then((res) => {
          expect(res.body.user.mustChangePassword).to.eq(true);
        });
      });
    cy.get('input[aria-label="Search administrators"]').type(email);
    cy.contains('td', email).should('be.visible');
  });

  it('2. the list shows administrators with 2FA badges', () => {
    cy.createAdminAccount('listed').then(() => {
      cy.visit('/settings/admins');
      cy.get('table tbody tr').should('have.length.at.least', 2);
      cy.get('[data-testid="admin-2fa-badge"]').should('have.length.at.least', 2).first().invoke('text').should('match', /2FA (on|off)/);
    });
  });

  it('3. deactivate with a reason: the row goes inactive and the admin existing token dies immediately', () => {
    cy.createAdminAccount('victim').then((victim) => {
      cy.task('resetThrottle', null, { log: false });
      cy.apiLogin(victim.email, victim.password).then((session) => {
        cy.apiAs(session.access_token, 'GET', '/auth/me').its('status').should('eq', 200);

        cy.visit('/settings/admins');
        cy.get('input[aria-label="Search administrators"]').type(victim.email);
        cy.get(`[aria-label="Deactivate ${victim.email}"]`).click();
        cy.get('[role="dialog"]').contains('button', /^Deactivate$/).should('be.disabled');
        cy.get('#admin-reason').type('e2e cleanup');
        cy.get('[role="dialog"]').contains('button', /^Deactivate$/).click();
        cy.contains('tr', victim.email).contains('Deactivated').should('be.visible');

        cy.apiAs(session.access_token, 'GET', '/auth/me').its('status').should('eq', 401);
        cy.task('resetThrottle', null, { log: false });
        cy.request({ method: 'POST', url: `${apiUrl()}/auth/login`, body: { identifier: victim.email, password: victim.password }, failOnStatusCode: false })
          .its('status')
          .should('eq', 401);

        // and it can be reactivated
        cy.get(`[aria-label="Activate ${victim.email}"]`).click();
        cy.contains('tr', victim.email).contains('Active').should('be.visible');
      });
    });
  });

  it('4. own row: Deactivate is disabled in the UI and the API refuses with 400 SELF_DEACTIVATE', () => {
    cy.visit('/settings/admins');
    cy.get('input[aria-label="Search administrators"]').type(Cypress.env('adminEmail'));
    cy.get(`[aria-label="Deactivate ${Cypress.env('adminEmail')}"]`).should('be.disabled');
    cy.rootToken().then((root) =>
      cy.apiAs(root, 'GET', `/platform-admins?search=${encodeURIComponent(Cypress.env('adminEmail'))}`).then((list) => {
        const me = list.body.data[0].id as string;
        cy.apiAs(root, 'PATCH', `/platform-admins/${me}/deactivate`, { reason: 'self test' }).then((res) => {
          expect(res.status).to.eq(400);
          expect(JSON.stringify(res.body)).to.contain('SELF_DEACTIVATE');
        });
      }),
    );
  });

  it('5. a server 409 LAST_ADMIN is surfaced to the operator (rule enforced server-side)', () => {
    const rows = (second: boolean) => ({
      data: [
        { id: 'me', name: 'Root', email: Cypress.env('adminEmail'), isActive: true, lastLoginAt: null, mustChangePassword: false, createdAt: '2026-01-01T00:00:00Z', twoFactorEnabled: false, activeSessions: 1 },
        { id: 'other', name: 'Only Other', email: 'only.other@e2e.test', isActive: true, lastLoginAt: null, mustChangePassword: false, createdAt: '2026-01-01T00:00:00Z', twoFactorEnabled: false, activeSessions: 0 },
        ...(second ? [{ id: 'third', name: 'Third', email: 'third.stub@e2e.test', isActive: true, lastLoginAt: null, mustChangePassword: false, createdAt: '2026-01-01T00:00:00Z', twoFactorEnabled: false, activeSessions: 0 }] : []),
      ],
      meta: { total: second ? 3 : 2, page: 1, limit: 20, totalPages: 1 },
    });

    // the server owns the rule (a real "last admin" cannot be built through the UI: the acting admin is always active)
    cy.intercept('GET', '**/api/platform-admins*', { body: rows(true) });
    cy.intercept('PATCH', '**/api/platform-admins/third/deactivate', {
      statusCode: 409,
      body: { statusCode: 409, code: 'LAST_ADMIN', message: 'Cannot deactivate the last active platform administrator', error: 'Conflict' },
    }).as('deactivate');
    cy.visit('/settings/admins');
    cy.get('[aria-label="Deactivate third.stub@e2e.test"]').click();
    cy.get('#admin-reason').type('stubbed 409 check');
    cy.get('[role="dialog"]').contains('button', /^Deactivate$/).click();
    cy.wait('@deactivate');
    cy.contains(/last active platform administrator/i).should('be.visible');
  });

  it('6. reset 2FA: the admin next sign-in no longer asks for a code', () => {
    cy.createAdminAccount('reset2fa').then((target) => {
      // enroll 2FA for the target through the API
      cy.task('resetThrottle', null, { log: false });
      cy.apiLogin(target.email, target.password).then((s) => {
        cy.apiAs(s.access_token, 'POST', '/admin/security/2fa/setup').then((setup) => {
          cy.task('totp', setup.body.secret).then((code) =>
            cy.apiAs(s.access_token, 'POST', '/admin/security/2fa/confirm', { code }).its('status').should('eq', 200),
          );
        });
      });
      cy.task('resetThrottle', null, { log: false });
      cy.request({ method: 'POST', url: `${apiUrl()}/auth/login`, body: { identifier: target.email, password: target.password } })
        .its('body.requires2fa')
        .should('eq', true);

      cy.visit('/settings/admins');
      cy.get('input[aria-label="Search administrators"]').type(target.email);
      cy.contains('tr', target.email).find('[data-testid="admin-2fa-badge"]').should('have.text', '2FA on');
      cy.get(`[aria-label="Reset 2FA ${target.email}"]`).click();
      cy.get('#admin-reason').type('lost device (e2e)');
      cy.get('[role="dialog"]').contains('button', /^Reset 2FA$/).click();
      cy.contains('tr', target.email).find('[data-testid="admin-2fa-badge"]').should('have.text', '2FA off');

      cy.task('resetThrottle', null, { log: false });
      cy.request({ method: 'POST', url: `${apiUrl()}/auth/login`, body: { identifier: target.email, password: target.password } })
        .its('body')
        .should('have.property', 'access_token');
    });
  });

  it('7. audit: create and deactivate are recorded with the actor', () => {
    cy.createAdminAccount('audited').then((target) => {
      cy.rootToken().then((root) => {
        cy.apiAs(root, 'PATCH', `/platform-admins/${target.id}/deactivate`, { reason: 'audit check' }).its('status').should('eq', 200);
        cy.apiAs(root, 'GET', '/platform/audit-logs?entity=PlatformAdmin&limit=50').then((res) => {
          expect(res.status).to.eq(200);
          const items = (res.body.data ?? res.body.items ?? []) as Array<{ action: string; entityId: string; userName?: string; userId?: string }>;
          const mine = items.filter((i) => i.entityId === target.id);
          const actions = mine.map((i) => i.action);
          expect(actions).to.include('CREATE');
          expect(actions).to.include('DEACTIVATE');
          mine.forEach((i) => expect(i.userId ?? i.userName, 'actor recorded').to.be.ok);
        });
      });
    });
  });
});
