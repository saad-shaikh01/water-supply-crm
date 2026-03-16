export {};

const vendorUser = {
  id: 'vendor-user',
  name: 'Vendor Admin',
  email: 'admin@example.com',
  role: 'VENDOR_ADMIN',
  vendorId: 'vendor-1',
};

function stubVendorShellRequests() {
  cy.intercept('GET', '**/portal/notifications*', {
    statusCode: 200,
    body: { data: [] },
  }).as('getNotifications');
  cy.intercept('GET', '**/portal/notifications/unread-count', {
    statusCode: 200,
    body: { count: 0 },
  }).as('getUnreadCount');
}

function stubOverviewRequests() {
  cy.intercept('GET', '**/dashboard/overview', {
    statusCode: 200,
    body: {
      totalCustomers: 24,
      totalProducts: 4,
      totalRoutes: 3,
      todaySheets: 2,
      monthlyRevenue: 100000,
      totalOutstandingBalance: 5000,
      pendingPayments: 1,
      openTickets: 0,
      openDeliveryIssues: 0,
      onDemandQueue: 0,
      totalDrivers: 3,
      todayCollections: 4000,
    },
  }).as('getOverview');
  cy.intercept('GET', '**/dashboard/revenue*', {
    statusCode: 200,
    body: [],
  }).as('getRevenue');
  cy.intercept('GET', '**/dashboard/top-customers*', {
    statusCode: 200,
    body: [],
  }).as('getTopCustomers');
  cy.intercept('GET', '**/dashboard/route-performance*', {
    statusCode: 200,
    body: [],
  }).as('getRoutePerformance');
  cy.intercept('GET', '**/dashboard/performance/staff*', {
    statusCode: 200,
    body: [],
  }).as('getStaffPerformance');
}

describe('vendor dashboard auth flow', () => {
  it('logs in through the live form and routes to overview', () => {
    stubVendorShellRequests();
    stubOverviewRequests();
    cy.intercept('POST', '**/auth/login', (req) => {
      expect(req.body).to.deep.equal({
        identifier: 'admin@example.com',
        password: 'secret123',
      });

      req.reply({
        statusCode: 200,
        body: {
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          expires_in: 3600,
          user: vendorUser,
        },
      });
    }).as('login');

    cy.visit('/auth/login');

    cy.get('#identifier').type('admin@example.com');
    cy.get('#password').type('secret123');
    cy.contains('button', 'Sign In').click();

    cy.wait('@login');
    cy.location('pathname').should('eq', '/dashboard/overview');
    cy.contains('Overview').should('be.visible');
    cy.getCookie('auth_token').its('value').should('eq', 'access-token');
    cy.getCookie('user_role').its('value').should('eq', 'VENDOR_ADMIN');
  });

  it('submits forgot-password with the live email field', () => {
    cy.intercept('POST', '**/auth/forgot-password', (req) => {
      expect(req.body).to.deep.equal({ email: 'admin@example.com' });
      req.reply({
        statusCode: 200,
        body: { ok: true },
      });
    }).as('forgotPassword');

    cy.visit('/auth/forgot-password');

    cy.get('#email').type('admin@example.com');
    cy.contains('button', 'Send Reset Link').click();

    cy.wait('@forgotPassword');
    cy.location('pathname').should('eq', '/auth/forgot-password');
  });
});
