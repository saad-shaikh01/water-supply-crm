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

// ── Phase 5 helpers (API-level setup so UI specs stay focused) ─────────────

/** Authenticated API call as a given access token. */
Cypress.Commands.add('apiAs', (token: string, method: string, path: string, body?: unknown) =>
  cy.request({
    method,
    url: `${Cypress.env('apiUrl')}${path}`,
    headers: { Authorization: `Bearer ${token}` },
    body,
    failOnStatusCode: false,
  }),
);

/** Fresh root-admin access token (API login; resets the login throttler first). */
Cypress.Commands.add('rootToken', () => {
  cy.task('resetThrottle', null, { log: false });
  return cy.apiLogin(Cypress.env('adminEmail'), Cypress.env('adminPassword')).then((b) => b.access_token as string);
});

/**
 * Create a platform admin with a known password and clear its mustChangePassword flag (via the API change-password
 * endpoint) so UI logins land straight on the dashboard. Yields { id, email, password }.
 */
Cypress.Commands.add('createAdminAccount', (label: string) => {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const email = `${label}.${stamp}@e2e.test`;
  const initial = `Init#${stamp}Aa1`;
  const password = `Final#${stamp}Bb2`;
  return cy.rootToken().then((root) =>
    cy
      .apiAs(root, 'POST', '/platform-admins', { name: `E2E ${label}`, email, password: initial })
      .then((created) => {
        expect(created.status, 'create admin').to.eq(201);
        cy.task('resetThrottle', null, { log: false });
        return cy.apiLogin(email, initial).then((b) =>
          cy.apiAs(b.access_token, 'PATCH', '/users/me/change-password', { currentPassword: initial, newPassword: password }).then((r) => {
            expect(r.status, 'change password').to.be.oneOf([200, 204]);
            return { id: created.body.id as string, email, password };
          }),
        );
      }),
  );
});

/** Turn maintenance off and reset the policy settings this suite touches (call from afterEach). */
Cypress.Commands.add('resetPlatformSettings', () => {
  const reset = (token: string) =>
    cy.apiAs(token, 'PATCH', '/platform-settings', {
      'maintenance.enabled': false,
      'maintenance.message': '',
      'maintenance.eta': null,
      'security.require2faForSuperAdmin': false,
      'defaults.customerGroupingEnabled': false,
    });
  cy.task('resetThrottle', null, { log: false });
  cy.request({
    method: 'POST',
    url: `${Cypress.env('apiUrl')}/auth/login`,
    body: { identifier: Cypress.env('adminEmail'), password: Cypress.env('adminPassword') },
    failOnStatusCode: false,
  }).then((res) => {
    if (res.body?.access_token) {
      reset(res.body.access_token);
      return;
    }
    // enforcement was left ON by a failed test: root cannot sign in to turn it off
    cy.task('forceEnforcementOff');
    cy.wait(6000); // in-process settings memo is 5 s
    cy.rootToken().then(reset);
  });
});

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
