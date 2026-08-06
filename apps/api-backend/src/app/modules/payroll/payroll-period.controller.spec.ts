import 'reflect-metadata';
import { PayrollPeriodController } from './payroll-period.controller';
import { AUTHENTICATED_ONLY_KEY } from '../../common/decorators/authz-markers.decorator';
import {
  PERMISSIONS_KEY,
  type RequiredPermissionsMeta,
} from '../../common/decorators/require-permissions.decorator';

// ─── fixtures ─────────────────────────────────────────────────────────────────

const user = { userId: 'admin-001', vendorId: 'vendor-001', role: 'VENDOR_ADMIN' } as any;

function makeController() {
  const service = {
    getOrCreateOpenPeriod: jest.fn().mockResolvedValue({ id: 'period-001' }),
    lockPeriod: jest.fn().mockResolvedValue({ period: { id: 'period-001' }, lockedEntryCount: 1 }),
    unlockPeriod: jest.fn().mockResolvedValue({ period: { id: 'period-001' }, unlockedEntryCount: 1 }),
  };
  const controller = new PayrollPeriodController(service as any);
  return { controller, service };
}

// ─── authorization metadata ────────────────────────────────────────────────────

describe('PayrollPeriodController — authorization metadata', () => {
  const proto = PayrollPeriodController.prototype as any;

  const permissionByMethod: Record<string, string> = {
    getOrCreateOpenPeriod: 'payroll:period_generate',
    lockPeriod: 'payroll:period_lock',
    unlockPeriod: 'payroll:period_unlock',
  };

  it.each(Object.entries(permissionByMethod))('%s requires exactly %s', (methodName, permission) => {
    const meta = Reflect.getMetadata(PERMISSIONS_KEY, proto[methodName]) as RequiredPermissionsMeta;
    expect(meta).toEqual({ mode: 'all', permissions: [permission] });
  });

  it.each(Object.keys(permissionByMethod))(
    '%s does NOT carry AUTHENTICATED_ONLY (which would bypass the permission check)',
    (methodName) => {
      expect(Reflect.getMetadata(AUTHENTICATED_ONLY_KEY, proto[methodName])).toBeUndefined();
    },
  );

  it('unlockPeriod requires ONLY payroll:period_unlock — a payroll:period_lock holder without it is still rejected', () => {
    const meta = Reflect.getMetadata(PERMISSIONS_KEY, proto.unlockPeriod) as RequiredPermissionsMeta;
    expect(meta.permissions).not.toContain('payroll:period_lock');
  });

  it('the controller class itself carries no blanket marker', () => {
    expect(Reflect.getMetadata(AUTHENTICATED_ONLY_KEY, PayrollPeriodController)).toBeUndefined();
    expect(Reflect.getMetadata(PERMISSIONS_KEY, PayrollPeriodController)).toBeUndefined();
  });
});

// ─── DTO binding pass-through ──────────────────────────────────────────────────

describe('PayrollPeriodController — pass-through', () => {
  it('getOrCreateOpenPeriod() forwards the current user to the service', async () => {
    const { controller, service } = makeController();
    await controller.getOrCreateOpenPeriod(user);
    expect(service.getOrCreateOpenPeriod).toHaveBeenCalledWith(user);
  });

  it('lockPeriod() forwards user and id param to the service', async () => {
    const { controller, service } = makeController();
    await controller.lockPeriod(user, 'period-001');
    expect(service.lockPeriod).toHaveBeenCalledWith(user, 'period-001');
  });

  it('unlockPeriod() forwards user, id param, and reason to the service', async () => {
    const { controller, service } = makeController();
    const dto = { reason: 'payroll miscalculated' };
    await controller.unlockPeriod(user, 'period-001', dto);
    expect(service.unlockPeriod).toHaveBeenCalledWith(user, 'period-001', dto.reason);
  });
});
