/**
 * Phase 5 - session list and revoke. Runs against the real API + admin panel.
 * One dedicated admin; two API logins stand in for two browsers. Every test starts from exactly two sessions.
 */
const apiUrl = () => Cypress.env('apiUrl') as string;

type Tokens = { access_token: string; refresh_token: string; user: { role: string } };

describe('sessions', () => {
  let acct: { id: string; email: string; password: string };
  let first: Tokens;
  let second: Tokens;
  const rows = '[data-testid="sessions-card"] table tbody tr';

  before(() => {
    cy.createAdminAccount('sessions').then((a) => {
      acct = a;
    });
  });

  beforeEach(() => {
    cy.task('resetThrottle', null, { log: false });
    cy.apiLogin(acct.email, acct.password).then((b) => {
      first = b as Tokens;
    });
    // drop sessions left over from earlier tests, then add the "other browser"
    cy.then(() => cy.apiAs(first.access_token, 'POST', '/admin/security/sessions/revoke-others').its('status').should('eq', 200));
    cy.task('resetThrottle', null, { log: false });
    cy.apiLogin(acct.email, acct.password).then((b) => {
      second = b as Tokens;
    });
    cy.then(() => cy.setSessionCookies({ auth: first.access_token, refresh: first.refresh_token, role: first.user.role }));
  });

  it('1. the Security page lists both sessions, exactly one marked Current', () => {
    cy.visit('/settings/security');
    cy.get(rows).should('have.length', 2);
    cy.get('[data-testid="current-session"]').should('have.length', 1);
  });

  it('2. revoking the other session kills its access token and refresh token immediately', () => {
    cy.apiAs(second.access_token, 'GET', '/auth/me').its('status').should('eq', 200);
    cy.visit('/settings/security');
    cy.get(rows).should('have.length', 2);
    cy.get(rows)
      .filter((_, el) => !el.querySelector('[data-testid="current-session"]'))
      .contains('button', 'Revoke')
      .click();
    cy.get('[role="dialog"]').contains('button', /^Revoke$/).click();
    cy.get(rows).should('have.length', 1);

    cy.apiAs(second.access_token, 'GET', '/auth/me').its('status').should('eq', 401);
    cy.request({ method: 'POST', url: `${apiUrl()}/auth/refresh`, body: { refreshToken: second.refresh_token }, failOnStatusCode: false })
      .its('status')
      .should('eq', 401);
    cy.apiAs(first.access_token, 'GET', '/auth/me').its('status').should('eq', 200);
  });

  it('3. revoke all others, then revoke the current session: back to the login page', () => {
    cy.visit('/settings/security');
    cy.get(rows).should('have.length', 2);
    cy.contains('button', 'Revoke all others').click();
    cy.get(rows).should('have.length', 1);
    cy.apiAs(second.access_token, 'GET', '/auth/me').its('status').should('eq', 401);

    cy.get(rows).contains('button', 'Revoke').click();
    cy.get('[role="dialog"]').should('contain.text', 'signs you out');
    cy.get('[role="dialog"]').contains('button', /^Revoke$/).click();
    cy.location('pathname', { timeout: 15000 }).should('eq', '/auth/login');
    cy.apiAs(first.access_token, 'GET', '/auth/me').its('status').should('eq', 401);
  });
});
