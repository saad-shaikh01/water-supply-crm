import {
  CSV_BODY, VENDOR_A, VENDOR_B, auditFacets, auditPage, auditRows, failedJobs, healthOk, importRow, vendorsList, waAccounts,
} from '../fixtures/phase3/data';

const API = '/api';
const route = (path: string) => ({ method: 'GET' as const, pathname: `${API}${path}` });

function stubVendors() {
  cy.intercept(route('/vendors'), { body: vendorsList }).as('vendors');
}

function stubAudit() {
  stubVendors();
  cy.intercept(route('/platform/audit-logs/facets'), { body: auditFacets }).as('facets');
  cy.intercept(route('/platform/audit-logs'), (req) => {
    req.reply({ body: auditPage(Number(req.query['page'] ?? 1)) });
  }).as('audit');
}

describe('Phase 3 observability', () => {
  beforeEach(() => cy.loginAsSuperAdmin());

  // ---------------------------------------------------------------- 1
  it('1. audit list and filters drive the request; clear resets; pagination requests page=2', () => {
    stubAudit();
    cy.visit('/audit-logs');
    cy.wait('@audit');
    cy.get('table tbody tr').should('have.length', auditRows.length);

    cy.get('#audit-vendor').select(VENDOR_A.name);
    cy.wait('@audit').its('request.query').should('deep.include', { vendorId: VENDOR_A.id, page: '1' });

    cy.get('#audit-from').type('2026-11-01');
    cy.wait('@audit').its('request.query').should('have.property', 'from', '2026-11-01');
    cy.get('#audit-to').type('2026-11-09');
    cy.wait('@audit').its('request.query').should('deep.include', { from: '2026-11-01', to: '2026-11-09' });

    cy.get('button[aria-label="Next page"]').click();
    cy.wait('@audit').its('request.query').should('deep.include', { page: '2', vendorId: VENDOR_A.id });
    cy.location('search').should('contain', 'page=2');

    // changing a filter resets to page 1
    cy.get('#audit-action').select('SUSPEND');
    cy.wait('@audit').its('request.query').should('deep.include', { action: 'SUSPEND', page: '1' });

    cy.contains('button', 'Clear filters').click();
    cy.get('#audit-vendor').should('have.value', '');
    cy.get('#audit-from').should('have.value', '');
    cy.get('#audit-action').should('have.value', '');
    cy.location('search').should('eq', '');
  });

  // ---------------------------------------------------------------- 2
  it('2. detail drawer shows the before/after diff, "no changes recorded", and closes on Esc', () => {
    stubAudit();
    cy.visit('/audit-logs');
    cy.wait('@audit');
    cy.get('table tbody tr').eq(0).click();
    cy.get('[data-testid="audit-drawer"]').within(() => {
      cy.get('[data-testid="diff-row"][data-kind="changed"]').should('have.length', 1).within(() => {
        cy.contains('isActive');
        cy.get('[data-testid="diff-before"]').should('contain.text', 'true');
        cy.get('[data-testid="diff-after"]').should('contain.text', 'false');
      });
      cy.get('[data-testid="audit-reason"]').should('contain.text', 'non-payment');
    });
    cy.get('body').type('{esc}');
    cy.get('[data-testid="audit-drawer"]').should('not.exist');

    cy.get('table tbody tr').eq(2).click();
    cy.get('[data-testid="audit-drawer"]').should('contain.text', 'No changes recorded');
    cy.get('body').type('{esc}');
    cy.get('[data-testid="audit-drawer"]').should('not.exist');
  });

  // ---------------------------------------------------------------- 3
  it('3. CSV export uses the active filters, downloads a file with a header row; 429 shows a toast', () => {
    stubAudit();
    cy.intercept(route('/platform/audit-logs/export.csv'), {
      statusCode: 200,
      headers: { 'content-type': 'text/csv; charset=utf-8', 'x-export-truncated': 'false', 'access-control-expose-headers': 'X-Export-Truncated' },
      body: CSV_BODY,
    }).as('export');
    cy.visit('/audit-logs');
    cy.wait('@audit');
    cy.get('#audit-vendor').select(VENDOR_B.name);
    cy.wait('@audit');
    cy.contains('button', 'Export CSV').click();
    cy.wait('@export').then(({ request }) => {
      expect(request.query).to.have.property('vendorId', VENDOR_B.id);
      expect(request.query).to.not.have.property('page');
    });
    const file = `${Cypress.config('downloadsFolder')}/audit-logs-${new Date().toISOString().slice(0, 10)}.csv`;
    cy.readFile(file, { timeout: 15000 }).should('contain', 'createdAt,vendorId,vendorName');

    cy.intercept(route('/platform/audit-logs/export.csv'), { statusCode: 429, body: { statusCode: 429, message: 'ThrottlerException' } }).as('export429');
    cy.contains('button', 'Export CSV').click();
    cy.wait('@export429');
    cy.contains(/try again in a minute/i).should('be.visible');
  });

  // ---------------------------------------------------------------- 4
  it('4. system health: healthy banner + 12 queues, redis down degrades, failed-jobs dialog, refresh=true', () => {
    let redisDown = false;
    cy.intercept(route('/platform/health'), (req) => {
      const body = redisDown
        ? healthOk({ redis: { status: 'down', latencyMs: null, usedMemoryMb: null, maxmemoryPolicy: null, policyOk: null } })
        : healthOk();
      req.reply({ body });
    }).as('health');
    cy.intercept(route('/platform/health/queues/whatsapp/failed'), { body: failedJobs }).as('failed');

    cy.visit('/system-health');
    cy.wait('@health');
    cy.get('[data-testid="health-banner"]').should('have.attr', 'data-status', 'healthy');
    cy.get('[data-testid="queue-row"]').should('have.length', 12);

    // failed queue drill-down: reasons only, no payload
    cy.get('[data-testid="queue-row"][data-failed="true"]').should('have.length', 1).find('button').click();
    cy.wait('@failed').its('request.query').should('have.property', 'limit', '10');
    cy.get('[data-testid="failed-jobs-dialog"]').within(() => {
      cy.contains('Template rejected by Meta');
      cy.get('[data-testid="failed-job"]').should('have.length', 1);
    });
    cy.get('[data-testid="failed-jobs-dialog"]').invoke('text').should('not.match', /"data"|"opts"|"payload"/i);
    cy.get('body').type('{esc}');

    // refresh now sends refresh=true and disables the button; redis down => degraded but page still rendered
    cy.then(() => {
      redisDown = true;
    });
    cy.contains('button', 'Refresh now').click().should('be.disabled');
    cy.wait('@health').its('request.query').should('have.property', 'refresh', 'true');
    cy.get('[data-testid="health-banner"]').should('have.attr', 'data-status', 'degraded');
    cy.get('[data-testid="card-redis"]').should('contain.text', 'down');
    cy.get('[data-testid="card-db"]').should('contain.text', 'up');
    cy.get('[data-testid="queue-row"]').should('have.length', 12);
    cy.get('[data-testid="runtime-card"]').should('contain.text', '1.2.3');
  });

  // ---------------------------------------------------------------- 5
  it('5. whatsapp: assign with 409 -> replace confirm, unassign confirm, never any credential strings', () => {
    let accounts = waAccounts();
    const bodies: string[] = [];
    const reply = (req: { reply: (r: unknown) => void }, body: unknown) => {
      bodies.push(JSON.stringify(body));
      req.reply({ body });
    };
    cy.intercept(route('/platform/whatsapp-accounts'), (req) =>
      reply(req, { data: accounts, meta: { total: accounts.length, page: 1, limit: 20, totalPages: 1 } }),
    ).as('wa');
    cy.intercept(route('/platform/whatsapp-accounts/assignable-vendors'), (req) => reply(req, [VENDOR_B])).as('assignable');
    let first = true;
    cy.intercept('POST', `${API}/platform/whatsapp-accounts/*/assign`, (req) => {
      if (first) {
        first = false;
        req.reply({ statusCode: 409, body: { statusCode: 409, code: 'VENDOR_HAS_ACCOUNT', message: 'already has account' } });
        return;
      }
      expect(req.body).to.deep.include({ vendorId: VENDOR_B.id, replace: true });
      accounts = accounts.map((a, i) => (i === 1 ? { ...a, vendors: [{ id: VENDOR_B.id, name: VENDOR_B.name, isActive: true }] } : a));
      reply(req, accounts[1]);
    }).as('assign');
    cy.intercept('POST', `${API}/platform/whatsapp-accounts/*/unassign`, (req) => {
      accounts = accounts.map((a, i) => (i === 0 ? { ...a, vendors: [] } : a));
      reply(req, accounts[0]);
    }).as('unassign');

    cy.visit('/whatsapp');
    cy.wait('@wa');
    cy.get('table tbody tr').should('have.length', 2);
    cy.get('[data-testid="vendor-chip"]').should('contain.text', VENDOR_A.name);

    cy.contains('tr', 'Spare line').contains('button', 'Assign').click();
    cy.wait('@assignable');
    cy.get('#wa-vendor-select').select(VENDOR_B.name);
    cy.get('[role="dialog"]').contains('button', /^Assign$/).click();
    cy.wait('@assign');
    cy.contains('Replace existing account?').should('be.visible');
    cy.get('[role="dialog"]').contains('button', 'Replace').click();
    cy.wait('@assign');
    cy.contains(/Vendor assigned/i).should('be.visible');
    cy.contains('tr', 'Spare line').find('[data-testid="vendor-chip"]').should('contain.text', VENDOR_B.name);

    cy.get(`button[aria-label="Unassign ${VENDOR_A.name}"]`).click();
    cy.get('[role="dialog"]').should('contain.text', 'does not delete the account');
    cy.get('[role="dialog"]').contains('button', /^Unassign$/).click();
    cy.wait('@unassign');
    cy.contains('tr', 'Main line').should('contain.text', 'None');

    // nothing credential-like in the DOM or in any response body the page received
    cy.document().then((doc) => {
      expect(doc.body.innerHTML).to.not.match(/tokenCipher|accessToken|access_token/i);
    });
    cy.then(() => {
      expect(bodies.length).to.be.greaterThan(0);
      bodies.forEach((b) => expect(b).to.not.match(/tokenCipher|accessToken/));
    });
  });

  it('5b. real API: platform whatsapp responses contain no credential fields', () => {
    cy.apiLogin(Cypress.env('adminEmail'), Cypress.env('adminPassword')).then((b) => {
      cy.request({ url: `${Cypress.env('apiUrl')}/platform/whatsapp-accounts?page=1&limit=50`, headers: { Authorization: `Bearer ${b.access_token}` } }).then((res) => {
        expect(res.status).to.eq(200);
        expect(JSON.stringify(res.body)).to.not.match(/tokenCipher|accessToken|appSecret/i);
        expect(res.body).to.have.property('meta');
      });
    });
  });

  // ---------------------------------------------------------------- 6
  it('6. imports monitor: stuck highlighted, status filter, drawer shows error + queue state, no download link', () => {
    stubVendors();
    const rows = [
      importRow(1, 'FAILED', { errorCode: 'IMPORT_EXEC_FAILED', errorMessage: 'Row 7 violates constraint' }),
      importRow(2, 'COMPLETED'),
      importRow(3, 'EXECUTING'),
    ];
    cy.intercept(route('/platform/imports/stats'), { body: { last7d: { COMPLETED: 5, FAILED: 1 }, stuck: 2 } }).as('stats');
    cy.intercept(route('/platform/imports'), (req) => {
      const status = req.query['status'];
      const data = status ? rows.filter((r) => r.status === status) : rows;
      req.reply({ body: { data, meta: { total: data.length, page: 1, limit: 20, totalPages: 1 } } });
    }).as('imports');
    cy.intercept(route(`/platform/imports/${rows[0].id}`), {
      body: { ...rows[0], queueState: { state: 'failed', attemptsMade: 3, failedReason: 'Row 7 violates constraint' } },
    }).as('detail');

    cy.visit('/imports');
    cy.wait('@imports');
    cy.get('table tbody tr').should('have.length', 3);
    cy.get('[data-testid="imports-stuck"]').should('have.attr', 'data-stuck', '2').and('contain.text', '2').and('have.class', 'border-red-500/50');

    cy.get('#imp-status').select('FAILED');
    cy.wait('@imports').its('request.query').should('have.property', 'status', 'FAILED');
    cy.get('table tbody tr').should('have.length', 1);

    cy.get('table tbody tr').contains('button', /./).click();
    cy.wait('@detail');
    cy.get('[data-testid="import-drawer"]').within(() => {
      cy.get('[data-testid="import-error"]').should('contain.text', 'IMPORT_EXEC_FAILED').and('contain.text', 'Row 7 violates constraint');
      cy.get('[data-testid="import-queue-state"]').should('contain.text', 'failed').and('contain.text', '3 attempts');
      cy.get('a[href]').should('not.exist');
      cy.contains(/download/i).should('not.exist');
    });
    cy.get('main a[href*="download"], main a[download]').should('not.exist');
  });

  // ---------------------------------------------------------------- 7
  it('7. access control: vendor admin is turned away; 403 from /platform shows a permission error; API refuses vendor tokens', () => {
    // 403 stubbed for a super admin session
    cy.intercept(route('/platform/audit-logs'), { statusCode: 403, body: { statusCode: 403, message: 'Forbidden resource' } }).as('forbidden');
    stubVendors();
    cy.intercept(route('/platform/audit-logs/facets'), { body: auditFacets });
    cy.visit('/audit-logs');
    cy.wait('@forbidden');
    cy.get('[role="alert"]', { timeout: 20000 }).should('be.visible');
  });

  it('7b. a VENDOR_ADMIN session is redirected away and the platform API returns 403 for its token', () => {
    cy.task('resetThrottle');
    cy.apiLogin(Cypress.env('vendorAdminEmail'), Cypress.env('vendorAdminPassword')).then((b) => {
      for (const p of ['/platform/audit-logs', '/platform/health', '/platform/whatsapp-accounts', '/platform/imports']) {
        cy.request({ url: `${Cypress.env('apiUrl')}${p}`, headers: { Authorization: `Bearer ${b.access_token}` }, failOnStatusCode: false })
          .its('status')
          .should('eq', 403);
      }
      cy.clearCookies();
      cy.setSessionCookies({ auth: b.access_token, refresh: b.refresh_token, role: 'VENDOR_ADMIN' });
    });
    for (const path of ['/audit-logs', '/system-health', '/whatsapp', '/imports']) {
      cy.visit(path);
      cy.location('pathname').should('eq', '/auth/login');
      cy.location('search').should('contain', 'reason=forbidden');
      cy.get('aside').should('not.exist');
      cy.setSessionCookies({ auth: 'x', refresh: 'x', role: 'VENDOR_ADMIN' });
    }
  });

  // ---------------------------------------------------------------- 8
  it('8. no horizontal page scroll at 375x812 on each page', () => {
    stubAudit();
    cy.intercept(route('/platform/health'), { body: healthOk() });
    cy.intercept(route('/platform/whatsapp-accounts'), { body: { data: waAccounts(), meta: { total: 2, page: 1, limit: 20, totalPages: 1 } } }).as('wa');
    cy.intercept(route('/platform/imports/stats'), { body: { last7d: { COMPLETED: 1 }, stuck: 1 } });
    cy.intercept(route('/platform/imports'), { body: { data: [importRow(1, 'FAILED', { errorMessage: 'x'.repeat(200) })], meta: { total: 1, page: 1, limit: 20, totalPages: 1 } } }).as('imp');
    cy.viewport(375, 812);
    const pages: Array<[string, string]> = [
      ['/audit-logs', 'table tbody tr'],
      ['/system-health', '[data-testid="queue-row"]'],
      ['/whatsapp', 'table tbody tr'],
      ['/imports', 'table tbody tr'],
    ];
    for (const [path, ready] of pages) {
      cy.visit(path);
      cy.get(ready).should('exist');
      cy.document().then((doc) => {
        expect(doc.documentElement.scrollWidth, `${path} scrollWidth`).to.be.at.most(doc.defaultView?.innerWidth ?? 375);
      });
    }
  });

  // ---------------------------------------------------------------- smoke
  it('smoke: real backend audit rows from suspend/unsuspend render with a real diff and export for real', () => {
    cy.apiLogin(Cypress.env('adminEmail'), Cypress.env('adminPassword')).then((b) => {
      const headers = { Authorization: `Bearer ${b.access_token}` };
      const api = Cypress.env('apiUrl');
      cy.request({ url: `${api}/vendors?limit=20`, headers }).then((res) => {
        const vendor = (res.body.data as Array<{ id: string; name: string; isActive: boolean }>).find((v) => v.isActive !== false);
        expect(vendor, 'an active vendor to suspend').to.not.equal(undefined);
        cy.request({ method: 'PATCH', url: `${api}/vendors/${vendor?.id}/suspend`, headers, body: { reason: 'e2e observability smoke' }, failOnStatusCode: false });
        cy.request({ method: 'PATCH', url: `${api}/vendors/${vendor?.id}/unsuspend`, headers, body: { reason: 'e2e observability smoke' }, failOnStatusCode: false });
        cy.wrap(vendor?.name).as('vendorName');
      });
    });
    cy.intercept('GET', '**/api/platform/audit-logs?*').as('real');
    cy.visit('/audit-logs?action=SUSPEND&entity=Vendor');
    cy.wait('@real').its('response.statusCode').should('eq', 200);
    cy.get('table tbody tr').should('have.length.at.least', 1);
    cy.get('table tbody tr').first().click();
    cy.get('[data-testid="audit-drawer"]').within(() => {
      cy.get('[data-testid="diff-row"][data-kind="changed"]').first().should('contain.text', 'isActive');
      cy.get('[data-testid="audit-reason"]').should('contain.text', 'e2e observability smoke');
    });
    cy.get('body').type('{esc}');
    cy.intercept('GET', '**/api/platform/audit-logs/export.csv*').as('realExport');
    cy.contains('button', 'Export CSV').click();
    cy.wait('@realExport').its('response.statusCode').should('eq', 200);
    cy.readFile(`${Cypress.config('downloadsFolder')}/audit-logs-${new Date().toISOString().slice(0, 10)}.csv`, { timeout: 15000 })
      .should('contain', 'createdAt,vendorId,vendorName')
      .and('contain', 'SUSPEND');

    // real health + imports + whatsapp pages render against the live API
    cy.visit('/system-health');
    cy.get('[data-testid="health-banner"]', { timeout: 20000 }).should('exist');
    cy.get('[data-testid="queue-row"]').should('have.length.at.least', 1);
    cy.visit('/imports');
    cy.get('[data-testid="imports-stats"]').should('exist');
    cy.visit('/whatsapp');
    cy.get('h1').should('contain.text', 'WhatsApp');
  });
});
