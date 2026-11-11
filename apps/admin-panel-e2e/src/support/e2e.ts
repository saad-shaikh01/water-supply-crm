import './commands';

// The API throttles auth endpoints per IP (login 5/min); reset before every test.
beforeEach(() => {
  cy.task('resetThrottle', null, { log: false });
});
