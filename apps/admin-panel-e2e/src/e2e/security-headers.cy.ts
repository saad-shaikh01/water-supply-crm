export {}; // module scope: keeps top-level consts private to this spec
/**
 * Phase 5 - security headers and CSP. Runs against the real API + admin panel.
 * HSTS is production-only (next.config adds it when NODE_ENV=production) and is asserted by a unit test.
 */
const apiUrl = () => Cypress.env('apiUrl') as string;

describe('security headers', () => {
  it('1. the login page sends the static headers and a CSP with frame-ancestors none', () => {
    cy.request('/auth/login').then((res) => {
      const h = res.headers;
      expect(h['x-frame-options']).to.eq('DENY');
      expect(h['x-content-type-options']).to.eq('nosniff');
      expect(h['referrer-policy']).to.eq('strict-origin-when-cross-origin');
      expect(h['permissions-policy']).to.contain('camera=()');
      const csp = (h['content-security-policy'] ?? h['content-security-policy-report-only']) as string;
      expect(csp, 'CSP present').to.be.a('string');
      expect(csp).to.contain("frame-ancestors 'none'");
      expect(csp).to.contain("object-src 'none'");
      expect(csp).to.match(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
    });
  });

  describe('2. no CSP violations on core pages', () => {
    const watch = () => {
      const violations: string[] = [];
      return {
        violations,
        onBeforeLoad(win: Cypress.AUTWindow) {
          win.document.addEventListener('securitypolicyviolation', (e) => {
            violations.push(`${e.violatedDirective} ${e.blockedURI} ${e.sourceFile}:${e.lineNumber}`);
          });
        },
      };
    };

    it('login', () => {
      const w = watch();
      cy.visit('/auth/login', { onBeforeLoad: w.onBeforeLoad });
      cy.get('#identifier').should('be.visible');
      cy.wait(500).then(() => expect(w.violations, w.violations.join('\n')).to.have.length(0));
    });

    for (const path of ['/vendors', '/settings', '/settings/security']) {
      it(`signed in: ${path}`, () => {
        cy.loginAsSuperAdmin();
        const w = watch();
        cy.visit(path, { onBeforeLoad: w.onBeforeLoad });
        cy.get('h1').should('be.visible');
        cy.wait(1000).then(() => expect(w.violations, w.violations.join('\n')).to.have.length(0));
      });
    }
  });

  it('3. the API sends helmet headers and no-store on the public status endpoint', () => {
    cy.request(`${apiUrl()}/platform/status`).then((res) => {
      expect(res.headers['x-content-type-options']).to.eq('nosniff');
      expect(res.headers['cache-control']).to.contain('no-store');
    });
  });
});
