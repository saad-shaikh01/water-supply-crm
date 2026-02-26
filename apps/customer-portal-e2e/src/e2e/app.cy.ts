describe('customer-portal smoke', () => {
  it('logs in and lands on dashboard', () => {
    cy.loginAsCustomer();
    cy.contains('Recent Activity').should('be.visible');
  });

  it('runs raast payment shell flow with live status', () => {
    cy.loginAsCustomer();

    cy.intercept('GET', '**/api/portal/payments*', {
      statusCode: 200,
      body: {
        data: [],
        meta: { total: 0, page: 1, limit: 20, totalPages: 1 },
      },
    }).as('getPayments');

    cy.intercept('GET', '**/api/portal/payment-info', {
      statusCode: 200,
      body: {
        raastId: 'RAAST-TEST-123',
        instructions: 'Use any banking app',
      },
    }).as('paymentInfo');

    cy.intercept('POST', '**/api/portal/payments/raast', (req) => {
      expect(req.body.amount).to.eq(1500);
      req.reply({
        statusCode: 201,
        body: {
          paymentRequestId: 'pay-123',
          checkoutUrl: 'https://example.com/checkout/pay-123',
          status: 'PROCESSING',
        },
      });
    }).as('createRaast');

    cy.intercept('GET', '**/api/portal/payments/pay-123', {
      statusCode: 200,
      body: {
        id: 'pay-123',
        status: 'PAID',
      },
    }).as('paymentStatus');

    cy.visit('/payments');
    cy.window().then((win) => {
      cy.stub(win, 'open').as('windowOpen');
    });

    cy.contains('button', 'Make Payment').click();
    cy.get('input[type="number"]').clear();
    cy.get('input[type="number"]').type('1500');
    cy.contains('button', 'Generate Raast QR').click();

    cy.wait('@createRaast');
    cy.wait('@paymentStatus');
    cy.get('@windowOpen').should('have.been.called');
    cy.contains('Payment Received').should('be.visible');
    cy.contains('button', 'Done').click();
  });

  it('creates and cancels an order', () => {
    cy.loginAsCustomer();

    cy.intercept('GET', '**/api/portal/orders*', {
      statusCode: 200,
      body: {
        data: [
          {
            id: 'order-1',
            status: 'PENDING',
            quantity: 1,
            createdAt: '2026-02-20T00:00:00.000Z',
            product: { name: '19L Bottle' },
          },
        ],
        meta: { total: 1, page: 1, limit: 20, totalPages: 1 },
      },
    }).as('getOrders');

    cy.intercept('GET', '**/api/portal/products', {
      statusCode: 200,
      body: [
        { id: 'prod-1', name: '19L Bottle', basePrice: 250 },
      ],
    }).as('getProducts');

    cy.intercept('POST', '**/api/portal/orders', (req) => {
      expect(req.body.productId).to.eq('prod-1');
      expect(req.body.quantity).to.be.greaterThan(0);
      req.reply({ statusCode: 201, body: { id: 'order-created' } });
    }).as('createOrder');

    cy.intercept('DELETE', '**/api/portal/orders/*', {
      statusCode: 200,
      body: { success: true },
    }).as('cancelOrder');

    cy.visit('/orders');
    cy.wait('@getOrders');

    cy.contains('button', 'Place Order').click();
    cy.wait('@getProducts');
    cy.get('select').first().select('prod-1');
    cy.get('input[type="number"]').clear();
    cy.get('input[type="number"]').type('2');
    cy.get('[role="dialog"]').contains('button', 'Place Order').click();

    cy.wait('@createOrder');
    cy.get('svg.lucide-x').first().parent('button').click();
    cy.wait('@cancelOrder');
  });

  it('creates a support ticket and shows reply indicator', () => {
    cy.loginAsCustomer();

    cy.intercept('GET', '**/api/portal/tickets*', {
      statusCode: 200,
      body: {
        data: [
          {
            id: 'ticket-1',
            type: 'COMPLAINT',
            status: 'OPEN',
            priority: 'NORMAL',
            subject: 'Late delivery',
            createdAt: '2026-02-10T00:00:00.000Z',
            vendorReply: 'Driver will arrive earlier tomorrow.',
          },
        ],
        meta: { total: 1, page: 1, limit: 20, totalPages: 1 },
      },
    }).as('getTickets');

    cy.intercept('POST', '**/api/portal/tickets', (req) => {
      expect(req.body.subject).to.eq('Need route update');
      expect(req.body.description).to.contain('Please update my delivery window');
      req.reply({ statusCode: 201, body: { id: 'ticket-created' } });
    }).as('createTicket');

    cy.visit('/support');
    cy.wait('@getTickets');
    cy.contains('Vendor Replied').should('be.visible');

    cy.contains('button', 'New Ticket').click();
    cy.get('input[placeholder="Brief summary of your issue..."]').type('Need route update');
    cy.get('textarea').last().type('Please update my delivery window for weekdays only.');
    cy.contains('button', 'Submit Ticket').click();

    cy.wait('@createTicket');
  });

  it('triggers statement download request', () => {
    cy.loginAsCustomer();

    cy.intercept('GET', '**/api/portal/statement*', {
      statusCode: 200,
      headers: { 'content-type': 'application/pdf' },
      body: '%PDF-1.4 mock pdf bytes',
    }).as('downloadStatement');

    cy.visit('/statement');
    cy.window().then((win) => {
      cy.stub(win.URL, 'createObjectURL').returns('blob:statement').as('createObjectUrl');
      cy.stub(win.URL, 'revokeObjectURL').as('revokeObjectUrl');
    });

    cy.contains('button', 'Download PDF Statement').click();

    cy.wait('@downloadStatement');
    cy.get('@createObjectUrl').should('have.been.called');
  });
});
