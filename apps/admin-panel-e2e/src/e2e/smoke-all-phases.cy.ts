/**
 * Shared smoke suite: one `it` per registered phase flow (see support/smoke-registry.ts).
 * Global guards: no uncaught page exception and no API response >= 500 during any flow.
 */
import { SMOKE_REGISTRY } from '../support/smoke-registry';

describe('smoke: all phases', () => {
  let serverErrors: string[];

  beforeEach(() => {
    serverErrors = [];
    cy.loginAsSuperAdmin();
    cy.intercept('**/api/**', (req) => {
      req.continue((res) => {
        if (res.statusCode >= 500) serverErrors.push(`${res.statusCode} ${req.method} ${req.url}`);
      });
    });
  });

  afterEach(() => {
    cy.then(() => expect(serverErrors, 'API responses >= 500').to.deep.equal([]));
  });

  for (const entry of SMOKE_REGISTRY) {
    it(`P${entry.phase}: ${entry.name}`, () => {
      entry.run();
    });
  }
});
