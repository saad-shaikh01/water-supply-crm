import type { Permission } from '@water-supply-crm/authz';

/**
 * Permission gates for the Fuel Card Wallet feature. `fuel_cards` is a
 * brand-new RBAC resource (owner-requested 2026-09-15), kept separate from
 * `fleet` so Accountant can get `topup`/`view` without inheriting the full
 * Fleet browse surface (`fleet:page`) — see
 * `libs/shared/authz/src/lib/permissions.ts`.
 */
export const FUEL_CARD_PERMISSIONS = {
  page: 'fuel_cards:page' as Permission,
  view: 'fuel_cards:view' as Permission,
  manage: 'fuel_cards:manage' as Permission,
  topup: 'fuel_cards:topup' as Permission,
  topupVoid: 'fuel_cards:topup_void' as Permission,
};
