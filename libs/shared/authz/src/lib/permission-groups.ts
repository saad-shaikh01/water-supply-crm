/**
 * UI-facing view of the catalog: grouped permissions with display labels for the
 * permission-management matrix and the `GET /permissions` endpoint. Derived from
 * PERMISSION_CATALOG so it can never drift from the frozen list.
 */
import {
  PERMISSION_CATALOG,
  RESOURCES,
  type Permission,
  type Resource,
} from './permissions';

/** Display label for each action verb used across the catalog. */
export const ACTION_LABELS: Record<string, string> = {
  page: 'Page access',
  view: 'View',
  create: 'Create',
  update: 'Update',
  edit: 'Edit',
  update_location: 'Update location',
  view_financial: 'View financial summary',
  delete: 'Delete',
  deactivate: 'Deactivate',
  restore: 'Restore',
  export: 'Export',
  clone: 'Clone',
  reset: 'Reset to preset',
  assign: 'Assign',
  manage_overrides: 'Manage overrides',
  manage_portal: 'Manage portal account',
  approve: 'Approve',
  reject: 'Reject',
  dispatch: 'Dispatch',
  add_stock: 'Add stock',
  adjust: 'Adjust',
  write_off: 'Write off',
  mark_damaged: 'Mark damaged / leaked',
  manage_repairs: 'Manage repairs',
  record_payment: 'Record payment',
  generate: 'Generate',
  load_out: 'Load out',
  check_in: 'Check in',
  close: 'Close',
  request_close: 'Request close (self-close)',
  approve_close: 'Approve close request',
  reject_close: 'Reject close request',
  confirm_crew: 'Confirm crew',
  swap_assignment: 'Swap assignment',
  bulk_import: 'Bulk import',
  manage_edit_locks: 'Manage edit locks',
  correct: 'Add correction',
  move_customer: 'Move customer to another van/sheet',
  manage_crew: 'Manage default crew',
  report_location: 'Report location',
  plan: 'Plan',
  resolve: 'Resolve',
  review: 'Review',
  charge: 'Charge',
  waive: 'Waive',
  reverse: 'Reverse',
  reply: 'Reply',
  configure: 'Configure',
  send: 'Send',
  manage: 'Manage',
  view_all: 'View all employees',
  ledger_create: 'Log ledger entry',
  ledger_approve: 'Approve ledger entry',
  ledger_void: 'Void ledger entry',
  ledger_reverse: 'Reverse ledger entry',
  ledger_correct: 'Correct ledger entry',
  salary_structure_manage: 'Manage salary structures',
  period_generate: 'Generate payroll draft',
  entry_approve: 'Approve payroll entry',
  period_lock: 'Lock payroll period',
  period_unlock: 'Unlock payroll period',
  settlement_record: 'Record settlement',
};

/** A single permission with display metadata for the role editor. */
export interface PermissionMeta {
  /** The permission string, e.g. `customers:update`. */
  key: Permission;
  /** The action verb, e.g. `update`. */
  action: string;
  /** Display label, e.g. `Update`. */
  label: string;
  /** True for the reserved `:page` route permission. */
  isPage: boolean;
}

/** A resource group (accordion section in the permission-management UI). */
export interface PermissionGroup {
  resource: Resource;
  label: string;
  /** True when the resource has a page/route (owns a `:page` permission). */
  navigable: boolean;
  permissions: PermissionMeta[];
}

/** Human-readable label for an action verb (falls back to the raw verb). */
export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

/** Grouped catalog for the UI — one group per resource, in catalog order. */
export const PERMISSION_GROUPS: readonly PermissionGroup[] = RESOURCES.map((resource) => {
  const def = PERMISSION_CATALOG[resource];
  return {
    resource,
    label: def.label,
    navigable: def.navigable,
    permissions: def.actions.map((action) => ({
      key: `${resource}:${action}` as Permission,
      action,
      label: actionLabel(action),
      isPage: action === 'page',
    })),
  };
});
