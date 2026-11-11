describe('access control', () => {
  it('C20a VENDOR_ADMIN cookies are rejected by the middleware and cleared', () => {
    cy.apiLogin(Cypress.env('vendorAdminEmail'), Cypress.env('vendorAdminPassword')).then((b) => {
      cy.setSessionCookies({ auth: b.access_token, refresh: b.refresh_token, role: 'VENDOR_ADMIN' });
    });
    cy.visit('/vendors');
    cy.location('pathname').should('eq', '/auth/login');
    cy.location('search').should('contain', 'reason=forbidden');
    cy.contains(/platform administrators only/i).should('be.visible');
    cy.getCookie('auth_token').should('not.exist');
    cy.getCookie('user_role').should('not.exist');
  });

  it('C20b forged user_role=SUPER_ADMIN with a VENDOR_ADMIN token never shows the shell', () => {
    cy.apiLogin(Cypress.env('vendorAdminEmail'), Cypress.env('vendorAdminPassword')).then((b) => {
      cy.setSessionCookies({ auth: b.access_token, refresh: b.refresh_token, role: 'SUPER_ADMIN' });
    });
    cy.intercept('GET', '**/auth/me').as('me');
    cy.intercept('GET', '**/dashboard/platform').as('platform');
    cy.visit('/');
    cy.wait('@me');
    cy.location('pathname').should('eq', '/auth/login');
    cy.location('search').should('contain', 'reason=forbidden');
    cy.get('aside').should('not.exist');
    cy.get('[data-testid^="kpi-"]').should('not.exist');
    cy.getCookie('auth_token').should('not.exist');
    // if the page ever requested platform data it must have been refused
    cy.get('@platform.all').then((calls) => {
      (calls as unknown as Array<{ response?: { statusCode: number } }>).forEach((c) =>
        expect(c.response?.statusCode).to.eq(403),
      );
    });
  });
});
