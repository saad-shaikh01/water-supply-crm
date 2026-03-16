export {};

const vendorUser = {
  id: 'vendor-user',
  name: 'Vendor Admin',
  email: 'admin@example.com',
  role: 'VENDOR_ADMIN',
  vendorId: 'vendor-1',
};

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

describe('vendor dashboard daily sheets flow', () => {
  it('generates sheets for selected vans using the current generate flow', () => {
    seedVendorSession();
    stubVendorShellRequests();

    cy.intercept('GET', '**/daily-sheets*', {
      statusCode: 200,
      body: {
        data: [
          {
            id: 'sheet-1',
            date: '2026-03-16T00:00:00.000Z',
            isClosed: false,
            filledOutCount: 10,
            filledInCount: 0,
            emptyInCount: 0,
            cashCollected: 0,
            route: { name: 'Central Route' },
            driver: { name: 'Driver One' },
            van: { plateNumber: 'LEA-123' },
            _count: { items: 4 },
          },
        ],
        meta: { total: 1 },
      },
    }).as('getSheets');
    cy.intercept('GET', '**/vans*', {
      statusCode: 200,
      body: {
        data: [{ id: 'van-1', plateNumber: 'LEA-123', isActive: true }],
        meta: { total: 1 },
      },
    }).as('getVans');
    cy.intercept('POST', '**/daily-sheets/generate', (req) => {
      expect(req.body).to.deep.equal({
        date: '2026-03-16',
        vanIds: ['van-1'],
      });

      req.reply({
        statusCode: 200,
        body: { jobId: 'job-1' },
      });
    }).as('generateSheets');
    cy.intercept('GET', '**/daily-sheets/generation-status/job-1', {
      statusCode: 200,
      body: {
        status: 'completed',
        progress: 100,
        result: { sheetIds: ['sheet-1'] },
      },
    }).as('generationStatus');

    cy.visit('/dashboard/daily-sheets');

    cy.wait(['@getSheets', '@getVans']);
    cy.contains('Daily Sheets').should('be.visible');
    cy.contains('Generate Sheet').click();

    cy.get('input[type="date"]').clear().type('2026-03-16');
    cy.contains('button', 'Select Specific').click();
    cy.contains('label', 'LEA-123').find('input[type="checkbox"]').check({ force: true });
    cy.contains('button', 'Generate Now').click();

    cy.wait('@generateSheets');
    cy.wait('@generationStatus');
    cy.contains('Success!').should('be.visible');
    cy.contains('Successfully generated 1 delivery sheets.').should('be.visible');
  });
});
