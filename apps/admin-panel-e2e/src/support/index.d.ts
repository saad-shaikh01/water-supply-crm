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
    /** Authenticated API call as the signed-in super admin. */
    adminApi(method: string, path: string, body?: unknown, failOnStatusCode?: boolean): Chainable<Cypress.Response<any>>;
    /** Create a throwaway vendor with an active admin; yields { id, name }. */
    createTestVendor(prefix?: string): Chainable<{ id: string; name: string }>;
    /** Set the three session cookies the panel reads. */
    setSessionCookies(c: { auth: string; refresh: string; role: string }): Chainable<void>;
  }
}
