const KPI = (id: string) => `[data-testid="kpi-${id}"]`;
const VALUE = 'p.text-2xl';

describe('dashboard', () => {
  beforeEach(() => cy.loginAsSuperAdmin());

  it('C10 renders every platform KPI + top vendors, never calls /dashboard/overview', () => {
    cy.intercept('GET', '**/dashboard/overview*', { statusCode: 404 }).as('overview');
    cy.interceptPlatform('platform-overview.json');
    cy.visit('/');
    cy.wait('@platform');
    cy.get(KPI('vendors-total')).should('contain.text', '12').and('contain.text', '+2 this month');
    cy.get(KPI('vendors-active')).should('contain.text', '9');
    cy.get(KPI('vendors-suspended')).should('contain.text', '3');
    cy.get(KPI('customers')).should('contain.text', '3,456');
    cy.get(KPI('drivers')).should('contain.text', '47');
    cy.get(KPI('revenue-month')).should('contain.text', 'Rs. 123,456').and('contain.text', '+23.5%');
    cy.get(KPI('revenue-all')).should('contain.text', 'Rs. 9,876,543');
    cy.get(KPI('deliveries')).should('contain.text', '8,910');
    cy.get('[data-testid="top-vendors"]').within(() => {
      cy.contains('Aqua Alpha');
      cy.contains('Blue Beta');
      cy.contains('Rs. 500,000');
    });
    cy.get('@overview.all').should('have.length', 0);
  });

  it('C11 on-screen numbers equal the real /dashboard/platform response', () => {
    cy.getCookie('auth_token').then((c) => {
      cy.request({
        url: `${Cypress.env('apiUrl')}/dashboard/platform`,
        headers: { Authorization: `Bearer ${c?.value}` },
      }).then(({ body }) => {
        const n = (v: number) => Number(v).toLocaleString('en-US');
        cy.visit('/');
        cy.get(KPI('vendors-total')).find(VALUE).should('have.text', n(body.vendors.total));
        cy.get(KPI('vendors-active')).find(VALUE).should('have.text', n(body.vendors.active));
        cy.get(KPI('vendors-suspended')).find(VALUE).should('have.text', n(body.vendors.suspended));
        cy.get(KPI('customers')).find(VALUE).should('have.text', n(body.customers.total));
        cy.get(KPI('drivers')).find(VALUE).should('have.text', n(body.drivers.totalActive));
        cy.get(KPI('deliveries')).find(VALUE).should('have.text', n(body.deliveries.thisMonth));
        cy.get(KPI('revenue-all')).should('contain.text', `Rs. ${n(body.revenue.allTime)}`);
        cy.get(KPI('revenue-month')).should('contain.text', `Rs. ${n(body.revenue.thisMonth)}`);
      });
    });
  });

  it('C12 500 shows ErrorState; Retry loads data', () => {
    cy.intercept('GET', '**/dashboard/platform', { statusCode: 500, body: { message: 'boom' } }).as('fail');
    cy.visit('/');
    cy.contains('Could not load platform overview', { timeout: 20000 }).should('be.visible');
    cy.intercept('GET', '**/dashboard/platform', { fixture: 'platform-overview.json' }).as('ok');
    cy.contains('button', 'Retry').click();
    cy.get(KPI('customers')).should('contain.text', '3,456');
  });

  it('C13 empty platform shows zeros and empty state, no NaN', () => {
    cy.interceptPlatform('platform-empty.json');
    cy.visit('/');
    cy.get(KPI('vendors-total')).should('contain.text', '0');
    cy.get(KPI('revenue-all')).should('contain.text', 'Rs. 0');
    cy.contains('No revenue yet').scrollIntoView().should('be.visible');
    cy.get('body').should('not.contain.text', 'NaN');
  });

  it('C14 suspending / unsuspending a vendor updates the Overview counter (no stale cache)', () => {
    cy.visit('/');
    cy.get(KPI('vendors-suspended'))
      .find(VALUE)
      .invoke('text')
      .then((t) => {
        const before = Number(t.replace(/,/g, ''));
        cy.contains('aside a', 'Vendors').click();
        cy.location('pathname').should('eq', '/vendors');
        cy.get('button[aria-label="Suspend vendor"]').first().click();
        cy.get('[role="dialog"], [role="alertdialog"]').contains('button', 'Suspend').click();
        cy.get('button[aria-label="Reactivate vendor"]').should('exist');

        cy.contains('aside a', 'Overview').click();
        cy.get(KPI('vendors-suspended')).find(VALUE).should('have.text', String(before + 1));
        // a hard reload also reads the invalidated backend cache
        cy.reload();
        cy.get(KPI('vendors-suspended')).find(VALUE).should('have.text', String(before + 1));

        cy.contains('aside a', 'Vendors').click();
        cy.get('button[aria-label="Reactivate vendor"]').first().click();
        cy.get('button[aria-label="Reactivate vendor"]').should('have.length', 0);
        cy.contains('aside a', 'Overview').click();
        cy.get(KPI('vendors-suspended')).find(VALUE).should('have.text', String(before));
      });
  });
});
