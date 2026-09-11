import 'reflect-metadata';
import { StaffAttendanceController } from './staff-attendance.controller';
import { AUTHENTICATED_ONLY_KEY } from '../../common/decorators/authz-markers.decorator';
import { PERMISSIONS_KEY, type RequiredPermissionsMeta } from '../../common/decorators/require-permissions.decorator';

const user = { userId: 'manager-001', vendorId: 'vendor-001', role: 'STAFF' } as any;

function makeController() {
  const service = {
    markStatus: jest.fn().mockResolvedValue({ id: 'att-001' }),
    listByPeriod: jest.fn().mockResolvedValue([]),
    listByEmployee: jest.fn().mockResolvedValue([]),
    listBySheet: jest.fn().mockResolvedValue([]),
  };
  const controller = new StaffAttendanceController(service as any);
  return { controller, service };
}

describe('StaffAttendanceController — authorization metadata', () => {
  const proto = StaffAttendanceController.prototype as any;

  const permissionByMethod: Record<string, string> = {
    mark: 'payroll:attendance_mark',
    listByPeriod: 'payroll:attendance_view',
  };

  it.each(Object.entries(permissionByMethod))('%s requires exactly %s', (methodName, permission) => {
    const meta = Reflect.getMetadata(PERMISSIONS_KEY, proto[methodName]) as RequiredPermissionsMeta;
    expect(meta).toEqual({ mode: 'all', permissions: [permission] });
  });

  it.each(Object.keys(permissionByMethod))('%s does NOT also carry AUTHENTICATED_ONLY', (methodName) => {
    expect(Reflect.getMetadata(AUTHENTICATED_ONLY_KEY, proto[methodName])).toBeUndefined();
  });

  it.each(['listByEmployee', 'listBySheet'])(
    '%s is @AuthenticatedOnly (self / sheet scoping is a code-level check, not RBAC)',
    (methodName) => {
      expect(Reflect.getMetadata(AUTHENTICATED_ONLY_KEY, proto[methodName])).toBe(true);
      expect(Reflect.getMetadata(PERMISSIONS_KEY, proto[methodName])).toBeUndefined();
    },
  );

  it('the controller class itself carries no blanket marker', () => {
    expect(Reflect.getMetadata(AUTHENTICATED_ONLY_KEY, StaffAttendanceController)).toBeUndefined();
    expect(Reflect.getMetadata(PERMISSIONS_KEY, StaffAttendanceController)).toBeUndefined();
  });
});

describe('StaffAttendanceController — pass-through', () => {
  it('mark() forwards user + dto to the service', async () => {
    const { controller, service } = makeController();
    const dto = { userId: 'u1', date: '2026-08-05', status: 'PRESENT' } as any;
    await controller.mark(user, dto);
    expect(service.markStatus).toHaveBeenCalledWith(user, dto);
  });

  it('listByPeriod() forwards user + periodId', async () => {
    const { controller, service } = makeController();
    await controller.listByPeriod(user, 'period-001');
    expect(service.listByPeriod).toHaveBeenCalledWith(user, 'period-001');
  });

  it('listByEmployee() forwards user + userId', async () => {
    const { controller, service } = makeController();
    await controller.listByEmployee(user, 'emp-001');
    expect(service.listByEmployee).toHaveBeenCalledWith(user, 'emp-001');
  });

  it('listBySheet() forwards user + dailySheetId', async () => {
    const { controller, service } = makeController();
    await controller.listBySheet(user, 'sheet-001');
    expect(service.listBySheet).toHaveBeenCalledWith(user, 'sheet-001');
  });
});
