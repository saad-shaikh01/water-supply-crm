/// <reference types="cypress" />

Cypress.Commands.add('apiLogin', (email: string, password: string) =>
  cy
    .request({
      method: 'POST',
      url: `${Cypress.env('apiUrl')}/auth/login`,
      body: { identifier: email, password },
    })
    .then((res) => {
      expect(res.status, 'login status').to.be.oneOf([200, 201]);
      return res.body;
    }),
);

Cypress.Commands.add('setSessionCookies', ({ auth, refresh, role }) => {
  cy.setCookie('auth_token', auth);
  cy.setCookie('refresh_token', refresh);
  cy.setCookie('user_role', role);
});

Cypress.Commands.add('loginAsSuperAdmin', () => {
  cy.session(
    'super-admin',
    () => {
      cy.task('resetThrottle');
      cy.apiLogin(Cypress.env('adminEmail'), Cypress.env('adminPassword')).then((b) => {
        cy.setSessionCookies({ auth: b.access_token, refresh: b.refresh_token, role: b.user.role });
      });
    },
    {
      validate() {
        cy.getCookie('auth_token').should('exist');
      },
    },
  );
});

Cypress.Commands.add('loginViaUi', (email: string, password: string) => {
  cy.visit('/auth/login');
  cy.get('#identifier').type(email);
  cy.get('#password').type(password, { log: false });
  cy.contains('button', /^Login$/).click();
});

Cypress.Commands.add('interceptPlatform', (fixture: string) =>
  cy.intercept('GET', '**/dashboard/platform', { fixture }).as('platform'),
);

/** Authenticated API call as the signed-in super admin (uses the auth_token cookie). */
Cypress.Commands.add('adminApi', (method: string, path: string, body?: unknown, failOnStatusCode = true) =>
  cy.getCookie('auth_token').then((c) =>
    cy.request({
      method,
      url: `${Cypress.env('apiUrl')}${path}`,
      headers: { Authorization: `Bearer ${c?.value}` },
      body: body as Cypress.RequestBody,
      failOnStatusCode,
    }),
  ),
);

/** Creates a throwaway vendor (with an active VENDOR_ADMIN) and yields { id, name }. */
Cypress.Commands.add('createTestVendor', (prefix = 'e2e') => {
  const n = `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  return cy
    .adminApi('POST', '/vendors', {
      name: `Vendor ${n}`,
      slug: `v-${n}`,
      adminEmail: `${n}@e2e.test`,
      adminPassword: 'E2eTest@12345',
      adminName: `Admin ${n}`,
    })
    .then((res) => ({ id: (res.body.vendor?.id ?? res.body.id) as string, name: `Vendor ${n}` }));
});
