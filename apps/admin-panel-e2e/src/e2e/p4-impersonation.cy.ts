/**
 * Phase 4 impersonation e2e against the REAL API (no stubs).
 *
 * Scope note: the admin-panel half (dialog, API call, handoff target, sessions list, revoke) is driven through
 * the browser. The vendor-dashboard half of the handoff (exchange page, banner, exit button) is covered at the API
 * level with cy.request (exchange the one-time code, use the impersonated token), because it lives on another origin.
 */
export {};

const API = () => Cypress.env('apiUrl') as string;
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const codeOf = (handoffUrl: string) => new URL(handoffUrl).searchParams.get('code') as string;

interface Started {
  sessionId: string;
  handoffUrl: string;
  target: { email: string };
}

function startSession(vendorId: string, mode: 'READ_ONLY' | 'SUPPORT') {
  return cy
    .adminApi('POST', '/platform/impersonation', { vendorId, reason: 'e2e support verification', mode, ttlMinutes: 15 })
    .then((r) => r.body as Started);
}

function exchange(handoffUrl: string, failOnStatusCode = true) {
  return cy.request({ method: 'POST', url: `${API()}/auth/impersonation/exchange`, body: { code: codeOf(handoffUrl) }, failOnStatusCode });
}

describe('Phase 4: impersonation', () => {
  beforeEach(() => cy.loginAsSuperAdmin());

  it('1. UI: reason is required, start calls the API and opens the vendor-dashboard handoff URL, session is listed and revocable', () => {
    cy.createTestVendor('imp').then((v) => {
      cy.intercept('POST', '**/api/platform/impersonation').as('start');
      cy.visit(`/vendors/${v.id}`);
      cy.window().then((win) => cy.stub(win, 'open').as('open'));

      cy.contains('button', 'Impersonate').click();
      cy.get('[role="dialog"]').within(() => {
        cy.contains('recorded in the audit log');
        cy.get('input[value="READ_ONLY"]').should('be.checked');
        cy.get('#imp-ttl option').then((o) => expect([...o].map((x) => (x as HTMLOptionElement).value)).to.deep.equal(['15', '30', '60']));
        cy.contains('button', 'Start impersonation').should('be.disabled');
        cy.get('#imp-reason').type('short');
        cy.contains('button', 'Start impersonation').should('be.disabled');
        cy.get('#imp-reason').clear().type('Support ticket 4242: checking delivery sheet');
        cy.get('#imp-ttl').select('15');
        cy.contains('button', 'Start impersonation').should('not.be.disabled').click();
      });

      cy.wait('@start').then(({ request, response }) => {
        expect(request.body).to.deep.include({ vendorId: v.id, mode: 'READ_ONLY', ttlMinutes: 15 });
        expect(response?.statusCode).to.eq(201);
        const url = new URL(response?.body.handoffUrl);
        expect(url.pathname).to.eq('/auth/impersonate');
        expect(url.searchParams.get('code')).to.have.length.greaterThan(15);
        cy.get('@open').should('have.been.calledWith', response?.body.handoffUrl, '_blank', 'noopener');
        cy.get('[data-testid="handoff-link"]').should('have.attr', 'href', response?.body.handoffUrl);
      });
      cy.get('[role="dialog"]').contains('button', 'Close').click();

      cy.visit(`/vendors/${v.id}?tab=impersonation`);
      cy.get('[data-testid="session-live"]').should('have.length', 1);
      cy.contains('td', 'Support ticket 4242');
      cy.contains('button', 'Revoke').click();
      cy.contains('td', 'revoked');
      cy.get('[data-testid="session-live"]').should('not.exist');
    });
  });

  it('2. UI: Billing tab shows the subscription card; Impersonate is disabled for a suspended vendor', () => {
    cy.createTestVendor('impb').then((v) => {
      cy.visit(`/vendors/${v.id}?tab=billing`);
      cy.get('[data-testid="vendor-subscription"]').should('exist');

      cy.adminApi('PATCH', `/vendors/${v.id}/suspend`, {});
      cy.visit(`/vendors/${v.id}`);
      cy.contains('button', 'Impersonate').should('be.disabled');
      cy.adminApi('PATCH', `/vendors/${v.id}/unsuspend`, {});
    });
  });

  it('3. API: backend refuses impersonating a suspended vendor and a short reason', () => {
    cy.createTestVendor('imps').then((v) => {
      cy.adminApi('POST', '/platform/impersonation', { vendorId: v.id, reason: 'short', mode: 'READ_ONLY' }, false).its('status').should('eq', 400);
      cy.adminApi('PATCH', `/vendors/${v.id}/suspend`, {});
      cy.adminApi('POST', '/platform/impersonation', { vendorId: v.id, reason: 'valid reason here', mode: 'READ_ONLY' }, false).its('status').should('eq', 400);
      cy.adminApi('PATCH', `/vendors/${v.id}/unsuspend`, {});
    });
  });

  it('4. handoff (API-level): READ_ONLY token can GET, write is 403, code is single-use, exit ends the session', () => {
    cy.createTestVendor('impr').then((v) => {
      startSession(v.id, 'READ_ONLY').then((s) => {
        expect(new URL(s.handoffUrl).pathname).to.eq('/auth/impersonate');
        exchange(s.handoffUrl).then((ex) => {
          expect(ex.body.impersonation).to.include({ sessionId: s.sessionId, mode: 'READ_ONLY' });
          expect(ex.body.user.role).to.eq('VENDOR_ADMIN');
          const token = ex.body.access_token as string;

          cy.request({ url: `${API()}/customers?limit=1`, headers: bearer(token) }).its('status').should('eq', 200);
          cy.request({ method: 'POST', url: `${API()}/vans`, headers: bearer(token), body: { vehiclePlateNumber: 'E2E-1' }, failOnStatusCode: false })
            .its('status')
            .should('eq', 403);

          // one-time code
          exchange(s.handoffUrl, false).its('status').should('eq', 401);

          // exit ends the session; the token stops working
          cy.request({ method: 'POST', url: `${API()}/auth/impersonation/exit`, headers: bearer(token) }).its('status').should('eq', 200);
          cy.request({ url: `${API()}/customers?limit=1`, headers: bearer(token), failOnStatusCode: false }).its('status').should('eq', 401);
        });
        cy.adminApi('GET', `/platform/impersonation?vendorId=${v.id}`).then((r) => {
          const row = r.body.data.find((x: { id: string }) => x.id === s.sessionId);
          expect(row.endedReason).to.eq('EXIT');
        });
      });
    });
  });

  it('5. handoff (API-level): SUPPORT token still cannot change passwords; revoke ends the session', () => {
    cy.createTestVendor('imps2').then((v) => {
      startSession(v.id, 'SUPPORT').then((s) => {
        exchange(s.handoffUrl).then((ex) => {
          const token = ex.body.access_token as string;
          cy.request({ url: `${API()}/customers?limit=1`, headers: bearer(token) }).its('status').should('eq', 200);
          cy.request({
            method: 'PATCH',
            url: `${API()}/users/me/change-password`,
            headers: bearer(token),
            body: { currentPassword: 'x', newPassword: 'Another@12345' },
            failOnStatusCode: false,
          })
            .its('status')
            .should('eq', 403);

          cy.adminApi('POST', `/platform/impersonation/${s.sessionId}/revoke`).its('status').should('eq', 200);
          cy.request({ url: `${API()}/customers?limit=1`, headers: bearer(token), failOnStatusCode: false }).its('status').should('eq', 401);
        });
      });
    });
  });

  it('6. an impersonated token cannot reach the platform surface', () => {
    cy.createTestVendor('impp').then((v) => {
      startSession(v.id, 'SUPPORT').then((s) => {
        exchange(s.handoffUrl).then((ex) => {
          const token = ex.body.access_token as string;
          cy.request({ method: 'POST', url: `${API()}/platform/impersonation`, headers: bearer(token), body: { vendorId: v.id, reason: 'nested attempt here', mode: 'SUPPORT' }, failOnStatusCode: false })
            .its('status')
            .should('eq', 403);
        });
      });
    });
  });
});
