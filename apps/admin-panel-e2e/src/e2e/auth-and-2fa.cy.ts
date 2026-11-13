export {}; // module scope: keeps top-level consts private to this spec
/**
 * Phase 5 - sign-in hardening and TOTP 2FA. Runs against the real API + admin panel.
 * Each scenario that changes an account uses its own freshly created admin so the shared root account stays 2FA-free.
 */
const apiUrl = () => Cypress.env('apiUrl') as string;

const uiLogin = (email: string, password: string) => {
  cy.task('resetThrottle', null, { log: false });
  cy.clearCookies();
  cy.loginViaUi(email, password);
};

describe('auth and 2FA', () => {
  afterEach(() => cy.resetPlatformSettings());

  it('1. unauthenticated visit to / redirects to /auth/login', () => {
    cy.visit('/');
    cy.location('pathname').should('eq', '/auth/login');
  });

  it('2. wrong passwords show a generic error; the account locks after 5 failures until an admin unlocks it', () => {
    cy.createAdminAccount('lock').then((acct) => {
      cy.visit('/auth/login');
      for (let i = 0; i < 5; i++) {
        cy.task('resetThrottle', null, { log: false });
        cy.get('#identifier').clear().type(acct.email);
        cy.get('#password').clear().type('Wrong@12345');
        cy.contains('button', /^Login$/).click();
        cy.get('[data-sonner-toast][data-front="true"]').contains(/invalid credentials/i).should('be.visible');
      }
      // locked: even the correct password is refused (same generic message, so a lock never confirms the account exists)
      cy.task('resetThrottle', null, { log: false });
      cy.request({ method: 'POST', url: `${apiUrl()}/auth/login`, body: { identifier: acct.email, password: acct.password }, failOnStatusCode: false })
        .its('status')
        .should('eq', 401);

      cy.rootToken().then((root) => cy.apiAs(root, 'POST', `/platform-admins/${acct.id}/unlock`).its('status').should('be.oneOf', [200, 201]));
      cy.task('resetThrottle', null, { log: false });
      cy.apiLogin(acct.email, acct.password).its('access_token').should('be.a', 'string');
    });
  });

  it('3. a vendor admin cannot sign in to the admin panel (no cookie, stays on login)', () => {
    uiLogin(Cypress.env('vendorAdminEmail'), Cypress.env('vendorAdminPassword'));
    cy.contains(/platform administrators only/i).should('be.visible');
    cy.location('pathname').should('eq', '/auth/login');
    cy.getCookie('auth_token').should('not.exist');
  });

  it('4. SUPER_ADMIN without 2FA lands on the dashboard; session cookies are SameSite=Strict', () => {
    uiLogin(Cypress.env('adminEmail'), Cypress.env('adminPassword'));
    cy.location('pathname').should('eq', '/');
    cy.getCookie('auth_token').should('have.property', 'sameSite', 'strict');
    cy.getCookie('refresh_token').should('have.property', 'sameSite', 'strict');
  });

  describe('enrolling and using 2FA (one dedicated admin)', () => {
    let acct: { id: string; email: string; password: string };
    let secret = '';
    let codes: string[] = [];

    before(() => {
      cy.createAdminAccount('twofa').then((a) => {
        acct = a;
      });
    });

    it('5. Settings -> Security -> enable: QR, code, 10 recovery codes shown once, status Enabled', () => {
      uiLogin(acct.email, acct.password);
      cy.location('pathname').should('eq', '/');
      cy.visit('/settings/security');
      cy.get('[data-testid="two-factor-status"]').should('have.text', 'Disabled');
      cy.contains('button', 'Enable two-factor authentication').click();
      cy.get('[role="dialog"] img[src^="data:image/png"]').should('be.visible');
      cy.get('[data-testid="totp-secret"]')
        .invoke('text')
        .then((s) => {
          secret = s.trim();
          expect(secret).to.match(/^[A-Z2-7]{16,}$/);
          cy.task('totp', secret).then((code) => cy.get('#security-code').type(String(code)));
        });
      cy.contains('[role="dialog"] button', 'Confirm and enable').click();
      cy.get('[data-testid="recovery-code"]', { timeout: 15000 }).should('have.length', 10);
      cy.get('[data-testid="recovery-code"]').then(($els) => {
        codes = [...$els].map((e) => e.textContent ?? '');
      });
      cy.contains('[role="dialog"] button', 'Done').should('be.disabled');
      cy.get('#codes-saved').check();
      cy.contains('[role="dialog"] button', 'Done').click();
      cy.get('[data-testid="two-factor-status"]').should('have.text', 'Enabled');
    });

    it('6. sign-in now asks for a code: wrong code rejected, TOTP works, a recovery code works once', () => {
      uiLogin(acct.email, acct.password);
      cy.get('#code').should('be.visible');
      cy.getCookie('auth_token').should('not.exist');

      cy.get('#code').type('000000');
      cy.contains('button', 'Verify').click();
      cy.get('#code').should('be.visible'); // still on the step after the rejection
      cy.getCookie('auth_token').should('not.exist');

      // next time-step: the code used to enroll is replay-protected
      cy.task('totpAhead', secret).then((code) => cy.get('#code').clear().type(String(code)));
      cy.contains('button', 'Verify').click();
      cy.location('pathname', { timeout: 20000 }).should('eq', '/');

      // recovery code: works once
      const recovery = codes[0];
      uiLogin(acct.email, acct.password);
      cy.contains('button', 'Use a recovery code instead').click();
      cy.get('#recoveryCode').type(recovery);
      cy.contains('button', 'Verify').click();
      cy.location('pathname', { timeout: 20000 }).should('eq', '/');

      // the same code again is rejected; remaining count dropped to 9 (checked through the API)
      cy.task('resetThrottle', null, { log: false });
      cy.request({ method: 'POST', url: `${apiUrl()}/auth/login`, body: { identifier: acct.email, password: acct.password } })
        .its('body.challengeToken')
        .then((challengeToken) =>
          cy
            .request({ method: 'POST', url: `${apiUrl()}/auth/2fa/verify`, body: { challengeToken, recoveryCode: recovery }, failOnStatusCode: false })
            .its('status')
            .should('eq', 401),
        );
      cy.task('resetThrottle', null, { log: false });
      cy.request({ method: 'POST', url: `${apiUrl()}/auth/login`, body: { identifier: acct.email, password: acct.password } })
        .its('body.challengeToken')
        .then((challengeToken) =>
          cy
            .request({ method: 'POST', url: `${apiUrl()}/auth/2fa/verify`, body: { challengeToken, recoveryCode: codes[1] } })
            .its('body.remainingRecoveryCodes')
            .should('eq', 8),
        );
    });
  });

  it('7. enforcement on: an admin without 2FA is forced to enroll at sign-in, then reaches the dashboard', () => {
    cy.createAdminAccount('enforce').then((acct) => {
      cy.rootToken().then((root) => cy.apiAs(root, 'PATCH', '/platform-settings', { 'security.require2faForSuperAdmin': true }).its('status').should('eq', 200));
      uiLogin(acct.email, acct.password);
      cy.get('[data-testid="enroll-2fa-step"] img[src^="data:image/png"]', { timeout: 15000 }).should('be.visible');
      cy.get('[data-testid="totp-secret"]')
        .invoke('text')
        .then((s) => cy.task('totp', s.trim()).then((code) => cy.get('#code').type(String(code))));
      cy.contains('button', 'Confirm and enable').click();
      cy.get('[data-testid="recovery-code"]', { timeout: 15000 }).should('have.length', 10);
      cy.contains('button', 'Continue').should('be.disabled');
      cy.get('#codes-saved').check();
      cy.contains('button', 'Continue').click();
      cy.location('pathname', { timeout: 20000 }).should('eq', '/');
      // this session belongs to the freshly enrolled admin: use it to switch enforcement off again
      cy.getCookie('auth_token').then((c) =>
        cy.apiAs(c!.value, 'PATCH', '/platform-settings', { 'security.require2faForSuperAdmin': false }).its('status').should('eq', 200),
      );
    });
  });
});
