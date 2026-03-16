export {};

const vendorUser = {
  id: 'vendor-user',
  name: 'Vendor Admin',
  email: 'admin@example.com',
  role: 'VENDOR_ADMIN',
  vendorId: 'vendor-1',
};

const routeId = '11111111-1111-4111-8111-111111111111';
const vanId = '22222222-2222-4222-8222-222222222222';

function seedVendorSession() {
  cy.visit('/auth/login');
  cy.setCookie('auth_token', 'access-token');
  cy.setCookie('refresh_token', 'refresh-token');
  cy.setCookie('user_role', 'VENDOR_ADMIN');
  cy.window().then((win) => {
    win.localStorage.setItem(
      'vendor-auth-store',
      JSON.stringify({
        state: { user: vendorUser },
        version: 0,
      })
    );
  });
}

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

describe('vendor dashboard customer flow', () => {
  it('creates a customer from the live customer page using current field names', () => {
    seedVendorSession();
    stubVendorShellRequests();

    cy.intercept('GET', '**/customers*', {
      statusCode: 200,
      body: {
        data: [
          {
            id: 'customer-1',
            name: 'Existing Customer',
            phoneNumber: '03001234567',
            address: 'Street 1',
            route: { name: 'Central Route' },
            financialBalance: 0,
            customerCode: 'CUS-001',
            paymentType: 'CASH',
            isActive: true,
            deliverySchedules: [{ dayOfWeek: 1 }],
          },
        ],
        meta: { total: 1 },
      },
    }).as('getCustomers');
    cy.intercept('GET', '**/routes*', {
      statusCode: 200,
      body: {
        data: [{ id: routeId, name: 'Central Route' }],
        meta: { total: 1 },
      },
    }).as('getRoutes');
    cy.intercept('GET', '**/vans*', {
      statusCode: 200,
      body: {
        data: [{ id: vanId, plateNumber: 'LEA-123', isActive: true }],
        meta: { total: 1 },
      },
    }).as('getVans');
    cy.intercept('POST', '**/customers', (req) => {
      expect(req.body).to.include({
        name: 'Ahmed Ali',
        phoneNumber: '03001234567',
        address: 'Street 10, Lahore',
        routeId,
        paymentType: 'CASH',
      });
      expect(req.body.googleMapsUrl).to.eq('https://maps.google.com/?q=31.52040,74.35870');
      expect(req.body.latitude).to.eq(31.5204);
      expect(req.body.longitude).to.eq(74.3587);
      expect(req.body.deliverySchedule).to.deep.equal([
        { dayOfWeek: 1, vanId, routeSequence: 4 },
      ]);

      req.reply({
        statusCode: 201,
        body: { id: 'customer-2' },
      });
    }).as('createCustomer');

    cy.visit('/dashboard/customers');

    cy.wait(['@getCustomers', '@getRoutes', '@getVans']);
    cy.contains('Customer Lists').should('be.visible');
    cy.contains('Existing Customer').should('be.visible');

    cy.contains('button', 'Add New Customer').click();

    cy.get('input[placeholder="Ahmed Ali"]').type('Ahmed Ali');
    cy.get('input[placeholder="0300-1234567"]').type('03001234567');
    cy.get('input[placeholder="House No / Building, Street, Area"]').type('Street 10, Lahore');
    cy.get('input[placeholder="Paste Google Maps share URL here..."]').type(
      'https://maps.google.com/?q=31.52040,74.35870'
    );

    cy.contains('button', 'Select route').click();
    cy.get('[role="option"]').contains('Central Route').click();
    cy.contains('button', 'Mon').click();
    cy.get('input[placeholder="Seq"]').clear().type('4');
    cy.contains('button', 'Onboard Customer').click();

    cy.wait('@createCustomer');
    cy.contains('button', 'Onboard Customer').should('not.exist');
  });
});
