/**
 * Smoke registry: one entry per phase flow, iterated by e2e/smoke-all-phases.cy.ts.
 * Phase owners ADD a line to SMOKE_REGISTRY (never edit another phase's line); the smoke spec itself never changes.
 * `run` executes inside an `it`, already signed in as the root SUPER_ADMIN.
 */
export interface SmokeEntry {
  phase: number;
  name: string;
  run: () => void;
}

export const SMOKE_REGISTRY: SmokeEntry[] = [
  {
    phase: 1,
    name: 'overview KPIs render and the vendors list loads',
    run: () => {
      cy.visit('/');
      cy.get('h1').should('contain.text', 'Platform Overview');
      cy.visit('/vendors');
      cy.get('h1').should('contain.text', 'Vendors');
      cy.get('table tbody tr').should('have.length.at.least', 1);
    },
  },
  {
    phase: 2,
    name: 'vendor detail opens',
    run: () => {
      cy.visit('/vendors');
      cy.get('table tbody tr a[href^="/vendors/"]').first().click();
      cy.location('pathname').should('match', /^\/vendors\/[0-9a-f-]{36}$/);
      cy.get('h1').should('be.visible');
    },
  },
  {
    phase: 3,
    name: 'audit logs and system health pages load',
    run: () => {
      cy.visit('/audit-logs');
      cy.get('h1').should('contain.text', 'Audit');
      cy.visit('/system-health');
      cy.get('h1').should('contain.text', 'System Health');
    },
  },
  {
    phase: 5,
    name: 'settings, platform admins and security pages load',
    run: () => {
      cy.visit('/settings');
      cy.get('h1').should('contain.text', 'Settings');
      cy.visit('/settings/admins');
      cy.get('h1').should('contain.text', 'Platform Administrators');
      cy.get('table tbody tr').should('have.length.at.least', 1);
      cy.visit('/settings/security');
      cy.get('h1').should('contain.text', 'Security');
      cy.get('[data-testid="two-factor-card"]').should('be.visible');
    },
  },
];
