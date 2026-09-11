import { ForbiddenException } from '@nestjs/common';
import type { AuthUser } from '@water-supply-crm/types';
import { PermissionService } from '../../modules/authz/permission.service';

/**
 * Self-view-only scoping for Staff Attendance reads — the small per-feature
 * equivalent of `payroll-view-scope.util.ts`'s `assertCanViewEmployeePayroll`
 * and `crew-cash-view-scope.util.ts`'s `assertCanViewEmployeeCrewCash`. Those
 * helpers each hardcode a different permission string internally, so this
 * mirrors their exact shape and reasoning rather than reusing one for a
 * permission it wasn't written for.
 *
 * Every role may read its OWN attendance history with no permission at all —
 * enforced in code, not RBAC, same as payroll/crew-cash. Seeing another
 * employee's attendance requires `payroll:attendance_view`.
 */
export async function assertCanViewEmployeeAttendance(
  permissions: PermissionService,
  user: AuthUser,
  targetUserId: string,
): Promise<void> {
  if (user.userId === targetUserId) return;

  const canViewAll = await permissions.can(user.userId, 'payroll:attendance_view');
  if (!canViewAll) {
    throw new ForbiddenException('You may only view your own attendance records.');
  }
}
