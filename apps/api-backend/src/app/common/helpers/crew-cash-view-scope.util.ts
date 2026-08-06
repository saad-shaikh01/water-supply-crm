import { ForbiddenException } from '@nestjs/common';
import type { AuthUser } from '@water-supply-crm/types';
import { PermissionService } from '../../modules/authz/permission.service';

/**
 * Self-view-only scoping for Crew Cash Distribution reads — the small
 * per-module equivalent of `payroll-view-scope.util.ts`'s
 * `assertCanViewEmployeePayroll`. That helper hardcodes the `payroll:view_all`
 * permission string internally, so it isn't directly reusable for a
 * different resource's permission (`crew_cash:view_all`); this mirrors its
 * exact shape and reasoning instead of duplicating the approach differently.
 *
 * Every role may see their OWN Crew Cash Distribution history (rows where
 * they are the recipient `employeeId`) with no permission at all — enforced
 * in code, not RBAC, same as payroll. Seeing another employee's history
 * requires `crew_cash:view_all`.
 */
export async function assertCanViewEmployeeCrewCash(
  permissions: PermissionService,
  user: AuthUser,
  targetEmployeeId: string,
): Promise<void> {
  if (user.userId === targetEmployeeId) return;

  const canViewAll = await permissions.can(user.userId, 'crew_cash:view_all');
  if (!canViewAll) {
    throw new ForbiddenException('You may only view your own Crew Cash Distribution history.');
  }
}
