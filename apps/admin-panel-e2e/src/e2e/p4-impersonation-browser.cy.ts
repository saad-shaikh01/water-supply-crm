/**
 * Phase 4 impersonation: REAL two-app browser flow (admin panel -> vendor-dashboard), no stubs of the API.
 *
 * The admin panel runs on CYPRESS_BASE_URL (http://127.0.0.1:4104). The API issues the handoffUrl on
 * VENDOR_DASHBOARD_URL (http://localhost:4204), a different origin, so the vendor-dashboard half runs inside
 * `cy.origin()`. Requires the API, admin panel and vendor-dashboard (built with NEXT_PUBLIC_API_URL pointing at the
 * API) to be running; override the vendor-dashboard origin with CYPRESS_VENDOR_DASHBOARD_URL.
 */
export {};

const VD = (Cypress.env('vendorDashboardUrl') as string) || 'http://localhost:4204';
const API = () => Cypress.env('apiUrl') as string;
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

interface Started {
  sessionId: string;
  handoffUrl: string;
}

/** Starts a session through the real admin-panel dialog and yields the handoff payload the API returned. */
function startViaAdminUi(vendorId: string, mode: 'READ_ONLY' | 'SUPPORT') {
  cy.intercept('POST', '**/api/platform/impersonation').as('start');
  cy.visit(`/vendors/${vendorId}`);
  cy.window().then((win) => cy.stub(win, 'open').as('open')); // the new tab is replaced by cy.origin below
  cy.contains('button', 'Impersonate').click();
  cy.get('[role="dialog"]').within(() => {
    if (mode === 'SUPPORT') cy.get('input[value="SUPPORT"]').check({ force: true });
    cy.get('#imp-reason').type('Browser e2e: verifying the vendor-dashboard handoff');
    cy.get('#imp-ttl').select('15');
    cy.contains('button', 'Start impersonation').click();
  });
  return cy.wait('@start').then(({ response }) => response?.body as Started);
}

describe('Phase 4: impersonation handoff in the vendor-dashboard (browser)', () => {
  let adminToken = '';
  beforeEach(() => {
    cy.loginAsSuperAdmin();
    cy.getCookie('auth_token').then((c) => (adminToken = c?.value as string));
  });

  it('READ_ONLY: exchange, banner, read-only enforcement, restricted controls, exit, ended screen, dead token and single-use code', () => {
    cy.createTestVendor('brw').then((v) => {
      // cy.intercept is not supported inside cy.origin(); register it here (the proxy sees all origins) and record the result.
      let vanCreate: { status?: number; body?: { code?: string; message?: string } } = {};
      let exitStatus: number | undefined;
      cy.intercept('POST', '**/api/vans', (req) => { req.on('response', (res) => { vanCreate = { status: res.statusCode, body: res.body }; }); });
      cy.intercept('POST', '**/auth/impersonation/exit', (req) => { req.on('response', (res) => { exitStatus = res.statusCode; }); });
      startViaAdminUi(v.id, 'READ_ONLY').then((s) => {
        expect(new URL(s.handoffUrl).origin).to.eq(new URL(VD).origin);
        cy.get('@open').should('have.been.calledWith', s.handoffUrl);

        cy.origin(
          VD,
          { args: { handoffUrl: s.handoffUrl, vendorName: v.name, api: API() } },
          ({ handoffUrl, vendorName, api }) => {
            // 1. exchange page -> dashboard, code stripped from the URL
            cy.visit(handoffUrl);
            cy.location('pathname', { timeout: 20000 }).should('eq', '/dashboard/overview');
            cy.location('search').should('eq', '');

            // 2. banner: admin name, mode and a live countdown; session cookies only, no refresh token
            cy.get('[data-testid="impersonation-banner"]', { timeout: 20000 })
              .should('contain.text', 'Support session')
              .and('contain.text', 'Read-only')
              .invoke('text')
              .then((t) => {
                expect(t).to.match(/viewing as Admin /);
                expect(t).to.match(/expires in 1[45]:\d\d|expires in 0\d:\d\d/);
              });
            cy.get('[data-testid="impersonation-banner"]').invoke('text').then((t1) => {
              cy.wait(2500);
              cy.get('[data-testid="impersonation-banner"]').invoke('text').should('not.eq', t1);
            });
            cy.getCookie('refresh_token').should('not.exist');
            cy.getCookie('impersonating').should('have.property', 'value', '1');

            // 3. reads load
            cy.visit('/dashboard/vans');
            cy.contains('h1, h2', 'Vans', { timeout: 20000 }).should('be.visible');
            cy.get('[data-testid="impersonation-banner"]').should('exist');

            // 4. a write in the UI is refused by the API (403 read-only) and nothing is created
            cy.contains('button', 'Add Van').click();
            cy.get('input[placeholder="ABC-1234"]').type('E2E-RO-1');
            cy.contains('button', 'Register Vehicle').click();
            cy.contains('Failed to create van').should('exist');
            cy.get('body').type('{esc}');

            // 5. Change Password is not offered; the vendor-user menu keeps only Sign Out (-> exits the session)
            cy.get('header button.rounded-full').last().click();
            cy.contains('[role="menuitem"]', 'Sign Out').should('be.visible');
            cy.contains('Change Password').should('not.exist');
            cy.get('body').type('{esc}');

            // 6. Exit -> ended screen, cookies gone, old token dead, API session ended
            cy.getCookie('auth_token').then((c) => {
              const token = c?.value as string;
              cy.get('[data-testid="impersonation-banner"]').contains('button', 'Exit').click();
              cy.location('pathname', { timeout: 20000 }).should('eq', '/auth/impersonate/ended');
              cy.get('[data-testid="impersonation-ended"]').should('contain.text', 'Support session ended');
              cy.getCookie('auth_token').should('not.exist');
              cy.getCookie('impersonating').should('not.exist');
              cy.request({ url: `${api}/customers?limit=1`, headers: { Authorization: `Bearer ${token}` }, failOnStatusCode: false })
                .its('status')
                .should('eq', 401);
            });

            // 7. dashboard is no longer reachable without a new login
            cy.visit('/dashboard/overview');
            cy.location('pathname').should('eq', '/auth/login');

            // 8. the handoff code is single-use: reusing the URL fails with a clear message
            cy.visit(handoffUrl);
            cy.get('[role="alert"]', { timeout: 20000 }).should('contain.text', 'invalid, expired or has already been used');
            cy.getCookie('auth_token').should('not.exist');
            cy.contains(vendorName).should('not.exist');
          },
        );

        cy.then(() => {
          expect(vanCreate.status, 'read-only write refused').to.eq(403);
          expect(vanCreate.body?.code).to.eq('IMPERSONATION_FORBIDDEN');
          expect(vanCreate.body?.message).to.match(/read-only/i);
          expect(exitStatus, 'exit call').to.be.oneOf([200, 201]);
        });

        // admin side: session is recorded as EXIT
        cy.request({ url: `${API()}/platform/impersonation?vendorId=${v.id}`, headers: bearer(adminToken) }).then((r) => {
          const row = r.body.data.find((x: { id: string }) => x.id === s.sessionId);
          expect(row.endedReason).to.eq('EXIT');
        });
      });
    });
  });

  it('SUPPORT: banner shows read/write mode and a write goes through the API', () => {
    cy.createTestVendor('brs').then((v) => {
      cy.request({
        method: 'POST',
        url: `${API()}/platform/impersonation`,
        headers: bearer(adminToken),
        body: { vendorId: v.id, reason: 'Browser e2e: support mode check', mode: 'SUPPORT', ttlMinutes: 15 },
      }).then((r) => {
        cy.origin(VD, { args: { handoffUrl: (r.body as Started).handoffUrl } }, ({ handoffUrl }) => {
          cy.visit(handoffUrl);
          cy.get('[data-testid="impersonation-banner"]', { timeout: 20000 }).should('contain.text', 'Support (read/write)');
          cy.visit('/dashboard/vans');
          cy.contains('button', 'Add Van', { timeout: 20000 }).click();
          cy.get('input[placeholder="ABC-1234"]').type('E2E-SUP-1');
          cy.contains('button', 'Register Vehicle').click();
          cy.contains('Van created').should('exist');
          cy.get('header button.rounded-full').last().click();
          cy.contains('Change Password').should('not.exist');
          cy.get('body').type('{esc}');
          // leave no live session cookie behind for the next test (a second handoff in a still-impersonating browser is not covered)
          cy.get('[data-testid="impersonation-banner"]').contains('button', 'Exit').click();
          cy.location('pathname', { timeout: 20000 }).should('eq', '/auth/impersonate/ended');
        });
      });
    });
  });

  it('revoking the session from the admin panel shows the ended screen on the next vendor-dashboard navigation', () => {
    cy.createTestVendor('brv').then((v) => {
      cy.request({
        method: 'POST',
        url: `${API()}/platform/impersonation`,
        headers: bearer(adminToken),
        body: { vendorId: v.id, reason: 'Browser e2e: revoke check', mode: 'READ_ONLY', ttlMinutes: 15 },
      }).then((r) => {
        const s = r.body as Started;
        cy.origin(VD, { args: { handoffUrl: s.handoffUrl } }, ({ handoffUrl }) => {
          cy.visit(handoffUrl);
          cy.get('[data-testid="impersonation-banner"]', { timeout: 20000 }).should('exist');
        });

        // revoke from the admin panel UI
        cy.visit(`/vendors/${v.id}?tab=impersonation`);
        cy.get('[data-testid="session-live"]').should('have.length', 1);
        cy.contains('button', 'Revoke').click();
        cy.contains('td', 'revoked');

        cy.origin(VD, () => {
          cy.visit('/dashboard/customers');
          cy.location('pathname', { timeout: 20000 }).should('eq', '/auth/impersonate/ended');
          cy.get('[data-testid="impersonation-ended"]').should('contain.text', 'Support session ended');
          cy.getCookie('auth_token').should('not.exist');
        });
      });
    });
  });
});
