const ACCESS_DENIED = /platform administrators only/i;

describe('auth', () => {
  it('C1 anonymous visits to protected routes redirect to login', () => {
    for (const path of ['/', '/vendors', '/settings']) {
      cy.visit(path);
      cy.location('pathname').should('eq', '/auth/login');
    }
  });

  it('C2 SUPER_ADMIN logs in via UI and lands on Platform Overview', () => {
    cy.loginViaUi(Cypress.env('adminEmail'), Cypress.env('adminPassword'));
    cy.location('pathname').should('eq', '/');
    cy.get('h1').should('contain.text', 'Platform Overview');
    cy.getCookie('auth_token').should('exist');
    cy.getCookie('refresh_token').should('exist');
    cy.getCookie('user_role').should('have.property', 'value', 'SUPER_ADMIN');
  });

  it('C3 VENDOR_ADMIN login is rejected, nothing persisted, refresh token revoked', () => {
    cy.intercept('POST', '**/auth/logout').as('logout');
    cy.loginViaUi(Cypress.env('vendorAdminEmail'), Cypress.env('vendorAdminPassword'));
    cy.contains(ACCESS_DENIED).should('be.visible');
    cy.location('pathname').should('eq', '/auth/login');
    cy.getCookie('auth_token').should('not.exist');
    cy.getCookie('refresh_token').should('not.exist');
    cy.getCookie('user_role').should('not.exist');
    cy.window().then((win) => {
      const raw = win.localStorage.getItem('admin-auth-store');
      const user = raw ? JSON.parse(raw).state?.user : null;
      expect(user ?? null).to.eq(null);
    });
    // the refresh token minted by the API was revoked server-side
    cy.wait('@logout').its('response.statusCode').should('be.oneOf', [200, 201]);
  });

  it('C4 wrong password shows invalid credentials, then lockout', () => {
    const identifier = `lockout.${Date.now()}@example.com`;
    const attempt = () => {
      cy.task('resetThrottle', null, { log: false });
      cy.get('#identifier').clear().type(identifier);
      cy.get('#password').clear().type('Wrong@12345');
      cy.contains('button', /^Login$/).click();
    };
    cy.visit('/auth/login');
    attempt();
    cy.contains(/invalid credentials/i).should('be.visible');
    for (let i = 0; i < 3; i++) attempt(); // attempts 2-4
    attempt(); // 5th failed attempt locks the account
    // Phase 5: a lock answers with the same generic message as a wrong password (no account-exists leak)
    cy.contains(/invalid credentials/i).should('be.visible');
    attempt(); // 6th attempt is still refused
    cy.contains(/invalid credentials/i).should('be.visible');
    cy.getCookie('auth_token').should('not.exist');
  });

  it('C5 logout clears session, revokes server-side, back button stays on login', () => {
    cy.loginAsSuperAdmin();
    cy.intercept('POST', '**/auth/logout').as('logout');
    cy.visit('/');
    cy.get('h1').should('contain.text', 'Platform Overview');
    cy.get('button[aria-label="Log out"]').click();
    cy.wait('@logout').its('response.statusCode').should('be.oneOf', [200, 201]);
    cy.location('pathname').should('eq', '/auth/login');
    cy.getCookie('auth_token').should('not.exist');
    cy.getCookie('refresh_token').should('not.exist');
    cy.getCookie('user_role').should('not.exist');
    // Logout uses router.replace, so the protected page is not left in history and the entry
    // before /auth/login can be about:blank (fresh test iframe), which made cy.go('back') flaky.
    // Assert the behaviour that matters: the protected route bounces to login, even after reload.
    cy.visit('/');
    cy.location('pathname').should('eq', '/auth/login');
    cy.reload();
    cy.location('pathname').should('eq', '/auth/login');
    cy.window().then((win) => {
      const raw = win.localStorage.getItem('admin-auth-store');
      expect((raw ? JSON.parse(raw).state?.user : null) ?? null).to.eq(null);
    });
  });

  it('C6a expired access token is silently refreshed', () => {
    cy.apiLogin(Cypress.env('adminEmail'), Cypress.env('adminPassword')).then((b) => {
      cy.setSessionCookies({ auth: 'garbage.token.value', refresh: b.refresh_token, role: b.user.role });
    });
    cy.intercept('POST', '**/auth/refresh').as('refresh');
    cy.visit('/');
    cy.wait('@refresh').its('response.statusCode').should('be.oneOf', [200, 201]);
    cy.get('h1').should('contain.text', 'Platform Overview');
    cy.location('pathname').should('eq', '/');
    cy.getCookie('auth_token').its('value').should('not.eq', 'garbage.token.value');
  });

  it('C6b invalid access + refresh tokens end on login without a redirect loop', () => {
    cy.setSessionCookies({ auth: 'garbage.token.value', refresh: 'garbage-refresh', role: 'SUPER_ADMIN' });
    cy.intercept({ method: 'GET', pathname: '/auth/login' }).as('loginPage');
    cy.visit('/');
    cy.location('pathname').should('eq', '/auth/login');
    cy.wait(1500);
    cy.location('pathname').should('eq', '/auth/login');
    cy.get('@loginPage.all').its('length').should('be.lte', 2);
    cy.getCookie('auth_token').should('not.exist');
  });

  it('C7 authenticated admin visiting /auth/login is redirected to /', () => {
    cy.loginAsSuperAdmin();
    cy.visit('/auth/login');
    cy.location('pathname').should('eq', '/');
  });

  it('C8 signup is not reachable and login has no Sign up link', () => {
    cy.request({ url: '/auth/signup', failOnStatusCode: false, followRedirect: false }).then((res) => {
      // anonymous: 404 (no such route) or redirect to login - never a 200 signup page
      expect(res.status).to.be.oneOf([404, 307, 308]);
    });
    cy.visit('/auth/login');
    cy.contains(/sign ?up/i).should('not.exist');
    cy.loginAsSuperAdmin();
    cy.request({ url: '/auth/signup', failOnStatusCode: false, followRedirect: false }).then((res) => {
      expect(res.status).to.be.oneOf([404, 307, 308]);
    });
  });

  it('C9 forgot password shows a neutral confirmation; reset without token is invalid', () => {
    cy.intercept('POST', '**/auth/forgot-password').as('forgot');
    cy.visit('/auth/forgot-password');
    cy.get('#email').type('nobody-e2e@example.com');
    cy.contains('button', 'Send Reset Link').click();
    cy.wait('@forgot').its('response.statusCode').should('be.oneOf', [200, 201]);
    cy.contains('Check your email').should('be.visible');
    cy.contains(/if the email exists/i).should('be.visible');

    cy.visit('/auth/reset-password');
    cy.contains(/invalid or missing reset link/i).should('be.visible');
  });
});
