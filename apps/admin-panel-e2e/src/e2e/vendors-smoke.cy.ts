describe('vendors smoke', () => {
  beforeEach(() => cy.loginAsSuperAdmin());

  it('C19a vendor list loads from the real API', () => {
    cy.visit('/vendors');
    cy.get('h1').should('contain.text', 'Vendors');
    cy.get('table tbody tr').should('have.length.at.least', 1);
  });

  it('C19b empty list shows EmptyState', () => {
    cy.intercept('GET', '**/api/vendors*', { body: { data: [], meta: { total: 0, page: 1, limit: 20 } } });
    cy.visit('/vendors');
    cy.contains('No vendors yet').should('be.visible');
  });

  it('C19c 500 shows ErrorState with Retry that recovers', () => {
    let failing = true;
    cy.intercept('GET', '**/api/vendors*', (req) => {
      if (failing) req.reply({ statusCode: 500, body: { message: 'boom' } });
      else req.continue();
    });
    cy.visit('/vendors');
    cy.get('[role="alert"]', { timeout: 20000 }).should('contain.text', 'boom');
    cy.then(() => {
      failing = false;
    });
    cy.contains('button', 'Retry').click();
    cy.get('table tbody tr').should('have.length.at.least', 1);
  });

  it('C19d create-vendor dialog opens', () => {
    cy.visit('/vendors');
    cy.contains('button', 'Add Vendor').click();
    cy.get('[role="dialog"]').should('be.visible');
  });
});
