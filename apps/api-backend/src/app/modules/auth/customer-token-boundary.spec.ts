import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { ALLOW_CUSTOMER_KEY } from '../../common/decorators/authz-markers.decorator';
import { AuthController } from './auth.controller';
import { FcmController } from '../fcm/fcm.controller';
import { NotificationPortalController } from '../notifications/notification-portal.controller';
import { NotificationPreferencesController } from '../notifications/notification-preferences.controller';
import { UserController } from '../user/user.controller';
import { CrewCashDistributionController } from '../payroll/crew-cash-distribution.controller';
import { StaffAttendanceController } from '../payroll/staff-attendance.controller';
import { PayrollEntryController } from '../payroll/payroll-entry.controller';
import { SheetAdvanceController } from '../payroll/sheet-advance.controller';

/**
 * Audit M4: a portal CUSTOMER token is "authenticated", so it used to pass every @AuthenticatedOnly staff
 * route (crew-cash / attendance lists…). Real controllers + real Reflector, so a new @AuthenticatedOnly
 * route is covered automatically (fail-closed) unless it opts in with @AllowCustomer().
 */
const guard = () =>
  new PermissionsGuard(new Reflector(), { getEffectivePermissions: async () => [] } as never);

const ctx = (controller: any, handler: string, role: string) =>
  ({
    getHandler: () => controller.prototype[handler],
    getClass: () => controller,
    switchToHttp: () => ({ getRequest: () => ({ user: { userId: 'u1', role, vendorId: 'v1' } }) }),
  }) as unknown as ExecutionContext;

describe('@AuthenticatedOnly staff routes vs a CUSTOMER token', () => {
  const staffRoutes: [any, string][] = [
    [CrewCashDistributionController, 'listForSheet'],
    [CrewCashDistributionController, 'listForEmployee'],
    [CrewCashDistributionController, 'update'],
    [StaffAttendanceController, 'listBySheet'],
    [StaffAttendanceController, 'listByEmployee'],
    [PayrollEntryController, 'getBreakdown'],
    [SheetAdvanceController, 'update'],
  ];

  it.each(staffRoutes)('%p.%s refuses a CUSTOMER token', async (controller, handler) => {
    await expect(guard().canActivate(ctx(controller, handler, 'CUSTOMER'))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it.each(staffRoutes)('%p.%s still admits vendor staff', async (controller, handler) => {
    await expect(guard().canActivate(ctx(controller, handler, 'STAFF'))).resolves.toBe(true);
  });
});

describe('customer-facing self-service routes stay reachable for CUSTOMER tokens', () => {
  const portalSafe: [any, string][] = [
    [AuthController, 'getProfile'],
    [FcmController, 'registerToken'],
    [NotificationPortalController, 'getFeed'],
    [NotificationPreferencesController, 'list'],
    [UserController, 'changePassword'],
  ];

  it.each(portalSafe)('%p.%s is marked @AllowCustomer and admits a CUSTOMER', async (controller, handler) => {
    if (typeof controller.prototype[handler] !== 'function') {
      // handler names differ per controller; fall back to the first method that exists
      handler = Object.getOwnPropertyNames(controller.prototype).find((n) => n !== 'constructor')!;
    }
    const marked =
      Reflect.getMetadata(ALLOW_CUSTOMER_KEY, controller.prototype[handler]) ??
      Reflect.getMetadata(ALLOW_CUSTOMER_KEY, controller);
    expect(marked).toBe(true);
    await expect(guard().canActivate(ctx(controller, handler, 'CUSTOMER'))).resolves.toBe(true);
  });
});
