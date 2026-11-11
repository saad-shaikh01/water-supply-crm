const NAV = [
  { label: 'Overview', path: '/' },
  { label: 'Vendors', path: '/vendors' },
  { label: 'Settings', path: '/settings' },
];

describe('navigation', () => {
  beforeEach(() => cy.loginAsSuperAdmin());

  it('C15 every sidebar link resolves with an h1 and the active pill follows the route', () => {
    cy.visit('/');
    for (const item of NAV) {
      cy.get('aside nav').contains('a', item.label).click();
      cy.location('pathname').should('eq', item.path);
      cy.get('h1').should('be.visible');
      cy.get('aside nav a[aria-current="page"]').should('have.length', 1).and('contain.text', item.label);
      cy.request(item.path).its('status').should('eq', 200);
    }
  });

  it('C16 /products and unknown paths show not-found; no Products nav entry', () => {
    cy.visit('/');
    cy.get('aside nav').should('not.contain.text', 'Products');
    for (const path of ['/products', '/definitely-not-a-page']) {
      cy.visit(path, { failOnStatusCode: false });
      cy.contains(/not found|could not find/i).should('be.visible');
    }
    cy.request({ url: '/products', failOnStatusCode: false }).its('status').should('eq', 404);
  });

  it('C17 settings is a placeholder empty state', () => {
    cy.visit('/settings');
    cy.get('h1').should('contain.text', 'Settings');
    cy.contains(/coming soon/i).should('be.visible');
  });

  it('C18 query params on /vendors are kept (nuqs) and drive the API request', () => {
    cy.intercept('GET', '**/api/vendors*').as('vendors');
    cy.visit('/vendors?page=1&limit=10');
    cy.wait('@vendors').its('request.url').should('match', /limit=10/);
    cy.get('h1').should('contain.text', 'Vendors');
    cy.location('search').should('contain', 'limit=10');
  });
});
