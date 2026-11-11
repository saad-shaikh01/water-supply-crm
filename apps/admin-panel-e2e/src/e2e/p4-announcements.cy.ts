/**
 * Phase 4 announcements e2e against the REAL API + queue worker (no stubs).
 * Targets a freshly created vendor so nothing is ever broadcast to the seeded vendors.
 */
export {};
const uniq = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 4)}`;

function selectVendorInComposer(name: string) {
  cy.get('#ann-audience').select('SELECTED_VENDORS');
  cy.get('input[aria-label="Search target vendors"]').type(name.slice(0, 20));
  cy.get(`input[aria-label="Target ${name}"]`).check();
  cy.get('[aria-label="Selected vendors"]').should('contain.text', name);
}

function waitForStats(id: string, delivered: number, tries = 20): Cypress.Chainable<unknown> {
  return cy.adminApi('GET', `/platform/announcements/${id}/stats`).then((r) => {
    if (r.body.status === 'SENT' && r.body.delivered >= delivered) return;
    expect(tries, 'stats polling attempts left').to.be.greaterThan(0);
    cy.wait(1000);
    return waitForStats(id, delivered, tries - 1);
  });
}

describe('Phase 4: announcements', () => {
  beforeEach(() => cy.loginAsSuperAdmin());

  it('1. composer validation and the send-to-all confirmation (cancelled, nothing sent)', () => {
    const title = `Guard ${uniq()}`;
    cy.visit('/announcements');
    cy.contains('button', 'New announcement').click();
    cy.get('[role="dialog"]').contains('button', 'Save draft').click();
    cy.get('[role="dialog"]').should('contain.text', 'Title is required').and('contain.text', 'Message is required');

    cy.get('#ann-title').type(title);
    cy.get('#ann-body').type('Body text');
    cy.get('#ann-audience').select('SELECTED_VENDORS');
    cy.get('[role="dialog"]').contains('button', 'Save draft').click();
    cy.get('[role="dialog"]').should('contain.text', 'Select at least one vendor');

    cy.get('#ann-schedule').type('2020-01-01T10:00');
    cy.get('[role="dialog"]').contains('button', 'Schedule').click();
    cy.get('[role="dialog"]').should('contain.text', 'must be in the future');

    // send to ALL asks for confirmation and shows the recipient estimate
    cy.get('#ann-audience').select('ALL_VENDORS');
    cy.get('#ann-schedule').clear();
    cy.get('[data-testid="ann-preview"]').should('contain.text', title.slice(0, 5));
    cy.get('[role="dialog"]').contains('button', 'Send now').click();
    cy.contains('Send announcement now?');
    cy.contains(/all \d+ active vendors/);
    cy.get('[role="dialog"]').contains('button', 'Cancel').click();
    cy.adminApi('GET', '/platform/announcements?limit=100').then((r) => {
      const found = (r.body.data as { title: string }[]).filter((a) => a.title === title);
      expect(found, 'nothing was created or sent').to.have.length(0);
    });
  });

  it('2. compose to a selected vendor, save draft, send, see delivered stats with read rate', () => {
    const title = `Selected ${uniq()}`;
    cy.createTestVendor('ann').then((vendor) => {
      cy.visit('/announcements');
      cy.contains('button', 'New announcement').click();
      cy.get('#ann-title').type(title);
      cy.get('#ann-body').type('Planned maintenance tonight.');
      cy.get('#ann-severity').select('IMPORTANT');
      selectVendorInComposer(vendor.name);
      cy.get('[data-testid="ann-preview"]').should('contain.text', `[Important] ${title}`);
      cy.get('[role="dialog"]').contains('button', 'Save draft').click();
      cy.get('[role="dialog"]').should('not.exist');
      cy.contains('tr', title).within(() => {
        cy.get('[data-status="DRAFT"]').should('exist');
        cy.contains('1 selected vendor');
      });

      // edit the draft (vendors preloaded), then send now with confirmation
      cy.contains('tr', title).find(`button[aria-label="Edit ${title}"]`).click();
      cy.get('[aria-label="Selected vendors"]').should('contain.text', vendor.name);
      cy.get('[role="dialog"]').contains('button', 'Send now').click();
      cy.contains(/1 selected vendor\(s\)/);
      cy.get('[role="dialog"]').last().contains('button', 'Send now').click();

      cy.adminApi('GET', '/platform/announcements?limit=100').then((r) => {
        const id = (r.body.data as { id: string; title: string }[]).find((a) => a.title === title)?.id as string;
        expect(id).to.be.a('string');
        waitForStats(id, 1).then(() => {
          cy.visit(`/announcements/${id}`);
          cy.get('[data-status="SENT"]').should('exist');
          cy.get('[data-testid="stat-recipients"]').should('have.text', '1');
          cy.get('[data-testid="stat-delivered"]').should('have.text', '1');
          cy.get('[data-testid="stat-read"]').should('have.text', '0');
          cy.get('[data-testid="stat-read-rate"]').should('have.text', '0%');
          cy.contains('td', vendor.name);
        });
      });
    });
  });

  it('3. schedule shows SCHEDULED, then cancel', () => {
    const title = `Scheduled ${uniq()}`;
    cy.createTestVendor('annsch').then((vendor) => {
      cy.visit('/announcements');
      cy.contains('button', 'New announcement').click();
      cy.get('#ann-title').type(title);
      cy.get('#ann-body').type('Scheduled message.');
      selectVendorInComposer(vendor.name);
      cy.get('#ann-schedule').type('2099-06-01T09:30');
      cy.get('[role="dialog"]').contains('button', 'Schedule').click();
      cy.get('[role="dialog"]').should('not.exist');

      cy.contains('tr', title).within(() => {
        cy.get('[data-status="SCHEDULED"]').should('exist');
        cy.contains('01 Jun 2099, 09:30 PKT');
        cy.get(`button[aria-label="Cancel ${title}"]`).click();
      });
      cy.contains('Cancel announcement?');
      cy.get('[role="dialog"]').contains('button', 'Cancel announcement').click();
      cy.contains('tr', title).find('[data-status="CANCELLED"]').should('exist');
      cy.contains('tr', title).find('button[aria-label^="Send"]').should('not.exist');

      // status filter
      cy.get('select[aria-label="Filter by status"]').select('CANCELLED');
      cy.contains('tr', title).should('exist');
      cy.location('search').should('contain', 'status=CANCELLED');
    });
  });
});
