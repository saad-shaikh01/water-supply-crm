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
