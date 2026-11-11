/// <reference types="cypress" />

declare namespace Cypress {
  interface Chainable {
    /** Log in over the API and cache the session (cookies) with cy.session. */
    loginAsSuperAdmin(): Chainable<void>;
    /** Real UI login through /auth/login. */
    loginViaUi(email: string, password: string): Chainable<void>;
    /** Raw API login, yields the response body ({access_token, refresh_token, user}). */
    apiLogin(
      email: string,
      password: string,
    ): Chainable<{ access_token: string; refresh_token: string; user: { id: string; role: string } }>;
    /** Stub GET /dashboard/platform with a fixture (alias @platform). */
    interceptPlatform(fixture: string): Chainable<null>;
    /** Set the three session cookies the panel reads. */
    setSessionCookies(c: { auth: string; refresh: string; role: string }): Chainable<void>;
    /** Authenticated API request that never fails on a non-2xx status. */
    apiAs(token: string, method: string, path: string, body?: unknown): Chainable<Cypress.Response<any>>;
    /** Fresh API access token for the configured root SUPER_ADMIN. */
    rootToken(): Chainable<string>;
    /** Create a SUPER_ADMIN with a known password (mustChangePassword cleared). */
    createAdminAccount(label: string): Chainable<{ id: string; email: string; password: string }>;
    /** Maintenance off + enforcement off + grouping default off. */
    resetPlatformSettings(): Chainable<void>;
  }
}
