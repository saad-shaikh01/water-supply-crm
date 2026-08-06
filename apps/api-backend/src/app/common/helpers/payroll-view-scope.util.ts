import { ForbiddenException } from '@nestjs/common';
import type { AuthUser } from '@water-supply-crm/types';
import { PermissionService } from '../../modules/authz/permission.service';

/**
 * Self-view-only scoping for payroll read endpoints (StaffLedgerController,
 * SalaryStructureController, PayrollEntryController). Every role may read
 * its OWN payroll/ledger records with no permission at all (§10 of the
 * planning doc: "self-scoping is enforced in code, not RBAC, since every
 * role needs to see their own"); seeing another employee's records requires
 * `payroll:view_all`. This is deliberately a code-level check rather than an
 * RBAC decorator — "my own record" cannot be resolved from route metadata
 * alone, only by comparing the resolved target `userId` at request time.
 */
export async function assertCanViewEmployeePayroll(
  permissions: PermissionService,
  user: AuthUser,
  targetUserId: string,
): Promise<void> {
  if (user.userId === targetUserId) return;

  const canViewAll = await permissions.can(user.userId, 'payroll:view_all');
  if (!canViewAll) {
    throw new ForbiddenException('You may only view your own payroll records.');
  }
}
