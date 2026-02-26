/// <reference types="cypress" />

const ACCESS_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLWN1c3RvbWVyLTEiLCJyb2xlIjoiQ1VTVE9NRVIiLCJjdXN0b21lcklkIjoiY3VzdC0xIn0.signature';

const LOGIN_RESPONSE = {
  access_token: ACCESS_TOKEN,
  refresh_token: 'refresh-token-1',
  expires_in: 86400,
  user: {
    id: 'user-customer-1',
    name: 'Test Customer',
    email: 'customer@example.com',
    role: 'CUSTOMER',
    customerId: 'cust-1',
  },
};

const PORTAL_PROFILE = {
  id: 'cust-1',
  name: 'Test Customer',
  phoneNumber: '03001234567',
  financialBalance: 1250,
  createdAt: '2026-01-01T00:00:00.000Z',
};

// eslint-disable-next-line @typescript-eslint/no-namespace
declare namespace Cypress {
  interface Chainable {
    loginAsCustomer(): Chainable<void>;
  }
}

Cypress.Commands.add('loginAsCustomer', () => {
  cy.intercept('POST', '**/api/auth/login', {
    statusCode: 200,
    body: LOGIN_RESPONSE,
  }).as('loginRequest');

  cy.intercept('GET', '**/api/portal/me', {
    statusCode: 200,
    body: PORTAL_PROFILE,
  }).as('portalMe');

  cy.intercept('GET', '**/api/portal/balance', {
    statusCode: 200,
    body: {
      bottleWallets: [
        {
          productId: 'prod-1',
          quantity: 2,
          effectivePrice: 250,
          product: { name: '19L Bottle' },
        },
      ],
    },
  }).as('portalBalance');

  cy.intercept('GET', '**/api/portal/summary', {
    statusCode: 200,
    body: {
      nextDeliveryDate: '2026-02-28T00:00:00.000Z',
      totalPaid: 3500,
      lastPaymentAmount: 1000,
      lastPaymentDate: '2026-02-20T00:00:00.000Z',
    },
  }).as('portalSummary');

  cy.intercept('GET', '**/api/portal/transactions*', {
    statusCode: 200,
    body: {
      data: [],
      meta: { total: 0, page: 1, limit: 5, totalPages: 1 },
    },
  }).as('portalTransactions');

  cy.intercept('GET', '**/api/portal/payment-info', {
    statusCode: 200,
    body: {
      raastId: 'RAAST-BOOTSTRAP',
      instructions: 'Use any banking app',
    },
  }).as('portalPaymentInfo');

  cy.visit('/auth/login');
  cy.get('#identifier').type('customer@example.com');
  cy.get('#password').type('Password123!');
  cy.contains('button', 'Sign In').click();

  cy.wait('@loginRequest');
  cy.setCookie('auth_token', ACCESS_TOKEN);
  cy.setCookie('refresh_token', 'refresh-token-1');
  cy.visit('/home');
  cy.contains('h1', 'Dashboard').should('be.visible');
});
