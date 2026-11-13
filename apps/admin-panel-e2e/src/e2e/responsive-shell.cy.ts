export {}; // module scope
/**
 * Responsive shell: off-canvas drawer below lg, fixed sidebar at lg+, no horizontal page scroll,
 * theme toggle persistence. Real stack by default.
 * CYPRESS_STUB_API=1 runs against a bare `next start` with a fake session and stubbed API (no backend needed).
 */
const stub = !!Cypress.env('STUB_API');
const VIEWPORTS = [
  { name: 'phone', w: 375, h: 812, drawer: true },
  { name: 'tablet', w: 768, h: 1024, drawer: true },
  { name: 'desktop', w: 1280, h: 800, drawer: false },
] as const;
const PAGES = ['/', '/vendors', '/audit-logs', '/system-health', '/billing', '/settings'];

const stubSession = () => {
  cy.setCookie('auth_token', 'stub');
  cy.setCookie('refresh_token', 'stub');
  cy.setCookie('user_role', 'SUPER_ADMIN');
  cy.intercept('GET', '**/api/**', (req) => {
    req.reply({ body: { data: [], items: [], total: 0, page: 1, limit: 10, totalPages: 0, meta: { total: 0, page: 1, limit: 10, totalPages: 0 } } });
  });
  cy.intercept('GET', '**/api/platform-settings*', { body: { settings: [] } });
  cy.intercept('GET', '**/api/auth/me', {
    body: { id: 'u1', name: 'Stub Admin', email: 'a@x.com', role: 'SUPER_ADMIN' },
  });
};

const noHorizontalScroll = () =>
  cy.document().then((doc) => {
    cy.window().then((win) => {
      expect(doc.documentElement.scrollWidth, 'documentElement.scrollWidth').to.be.at.most(win.innerWidth);
      expect(doc.body.scrollWidth, 'body.scrollWidth').to.be.at.most(win.innerWidth);
    });
  });

describe('responsive shell', () => {
  let vendorId = 'stub-vendor-id';

  before(() => {
    if (stub) return;
    cy.task('resetThrottle', null, { log: false });
    cy.apiLogin(Cypress.env('adminEmail'), Cypress.env('adminPassword')).then((b) => {
      cy.request({ url: `${Cypress.env('apiUrl')}/vendors?limit=1`, headers: { Authorization: `Bearer ${b.access_token}` } }).then((r) => {
        const rows = r.body.data ?? r.body.items ?? r.body;
        vendorId = rows[0]?.id ?? vendorId;
      });
    });
  });

  beforeEach(() => {
    if (stub) stubSession();
    else cy.loginAsSuperAdmin();
  });

  VIEWPORTS.forEach(({ name, w, h, drawer }) => {
    context(`${name} ${w}x${h}`, () => {
      beforeEach(() => cy.viewport(w, h));

      if (drawer) {
        it('hides the fixed sidebar and opens/closes the drawer', () => {
          cy.visit('/');
          cy.get('aside').should('not.be.visible');
          cy.get('[role="dialog"]').should('not.exist');
          cy.get('button[aria-label="Open navigation menu"]').should('be.visible').and('have.attr', 'aria-expanded', 'false').click();
          cy.get('[role="dialog"]').should('be.visible').find('nav a').should('have.length.at.least', 9);
          cy.get('[role="dialog"]').should('have.attr', 'aria-modal').and('not.equal', 'false');
          // Esc closes
          cy.get('body').type('{esc}');
          cy.get('[role="dialog"]').should('not.exist');
          // backdrop closes
          cy.get('button[aria-label="Open navigation menu"]').click();
          cy.get('[role="dialog"]').should('be.visible');
          cy.get('body').click(w - 5, h / 2, { force: true });
          cy.get('[role="dialog"]').should('not.exist');
        });

        it('closes the drawer on navigation', () => {
          cy.visit('/');
          cy.get('button[aria-label="Open navigation menu"]').click();
          cy.get('[role="dialog"] nav').contains('a', 'Audit Logs').click();
          cy.location('pathname').should('eq', '/audit-logs');
          cy.get('[role="dialog"]').should('not.exist');
        });

        it('moves focus into the drawer and restores it to the hamburger on Esc', () => {
          cy.visit('/');
          cy.get('button[aria-label="Open navigation menu"]').click();
          cy.get('[role="dialog"]').should('be.visible');
          cy.focused().closest('[role="dialog"]').should('exist');
          cy.get('body').type('{esc}');
          cy.get('[role="dialog"]').should('not.exist');
          cy.focused().should('have.attr', 'aria-label', 'Open navigation menu');
        });
      } else {
        it('shows the fixed sidebar and no hamburger', () => {
          cy.visit('/');
          cy.get('aside nav').should('be.visible');
          cy.get('aside').invoke('outerWidth').should('eq', 256);
          cy.get('button[aria-label="Open navigation menu"]').should('not.be.visible');
        });
      }

      [...PAGES, '/vendors/<id>'].forEach((p) => {
        it(`no horizontal page scroll on ${p}`, () => {
          cy.visit(p === '/vendors/<id>' ? `/vendors/${vendorId}` : p);
          cy.get('main').should('be.visible');
          cy.wait(500);
          noHorizontalScroll();
        });
      });
    });
  });

  it('login page has no horizontal scroll at 375px', () => {
    cy.clearAllCookies();
    cy.viewport(375, 812);
    cy.visit('/auth/login');
    cy.get('#identifier').should('be.visible');
    noHorizontalScroll();
  });

  it('theme toggle switches light/dark and persists across reload', () => {
    cy.viewport(375, 812);
    cy.visit('/');
    cy.get('html').then(($h) => {
      const start = $h.hasClass('dark') ? 'dark' : 'light';
      const other = start === 'dark' ? 'light' : 'dark';
      cy.contains('button', 'Toggle theme').click({ force: true });
      cy.get('html').should(other === 'dark' ? 'have.class' : 'not.have.class', 'dark');
      cy.get('body').should('have.css', 'background-color').and('not.equal', 'rgba(0, 0, 0, 0)');
      cy.reload();
      cy.get('html').should(other === 'dark' ? 'have.class' : 'not.have.class', 'dark');
      noHorizontalScroll();
    });
  });
});
