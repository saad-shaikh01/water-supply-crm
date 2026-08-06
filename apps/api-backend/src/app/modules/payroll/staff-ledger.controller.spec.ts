import 'reflect-metadata';
import { StaffLedgerController } from './staff-ledger.controller';
import { AUTHENTICATED_ONLY_KEY } from '../../common/decorators/authz-markers.decorator';
import {
  PERMISSIONS_KEY,
  type RequiredPermissionsMeta,
} from '../../common/decorators/require-permissions.decorator';

// ─── fixtures ─────────────────────────────────────────────────────────────────

const user = { userId: 'admin-001', vendorId: 'vendor-001', role: 'VENDOR_ADMIN' } as any;

function makeController() {
  const service = {
    create: jest.fn().mockResolvedValue({ id: 'entry-001' }),
    findForEmployee: jest.fn().mockResolvedValue({ data: [], meta: {} }),
    approve: jest.fn().mockResolvedValue({ id: 'entry-001' }),
    voidEntry: jest.fn().mockResolvedValue({ id: 'entry-001' }),
    reverse: jest.fn().mockResolvedValue({ original: {}, reversal: {} }),
    correct: jest.fn().mockResolvedValue({ original: {}, reversal: {}, correction: {} }),
  };
  const controller = new StaffLedgerController(service as any);
  return { controller, service };
}

// ─── authorization metadata ────────────────────────────────────────────────────
//
// The single global PermissionsGuard resolves PERMISSIONS_KEY /
// AUTHENTICATED_ONLY_KEY via `Reflector.getAllAndOverride([handler, class])`.
// These assertions pin down exactly what that guard will see for each route,
// which is what actually determines whether a DRIVER/CUSTOMER token is
// rejected and a VENDOR_ADMIN/STAFF token is accepted — see the module-level
// doc comment on StaffLedgerController for why the markers live per-method.

describe('StaffLedgerController — authorization metadata', () => {
  const proto = StaffLedgerController.prototype as any;

  const permissionByMethod: Record<string, string> = {
    create: 'payroll:ledger_create',
    approve: 'payroll:ledger_approve',
    reverse: 'payroll:ledger_reverse',
    correct: 'payroll:ledger_correct',
  };

  it.each(Object.entries(permissionByMethod))(
    '%s requires exactly %s',
    (methodName, permission) => {
      const meta = Reflect.getMetadata(PERMISSIONS_KEY, proto[methodName]) as RequiredPermissionsMeta;
      expect(meta).toEqual({ mode: 'all', permissions: [permission] });
    },
  );

  it.each(Object.keys(permissionByMethod))(
    '%s does NOT carry AUTHENTICATED_ONLY (which would bypass the permission check)',
    (methodName) => {
      expect(Reflect.getMetadata(AUTHENTICATED_ONLY_KEY, proto[methodName])).toBeUndefined();
    },
  );

  it('findForEmployee remains open to any authenticated user (self-view scoping is a code-level check, not RBAC)', () => {
    expect(Reflect.getMetadata(AUTHENTICATED_ONLY_KEY, proto.findForEmployee)).toBe(true);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, proto.findForEmployee)).toBeUndefined();
  });

  it('voidEntry is open to any authenticated user (permission-OR-creator decision lives in the service)', () => {
    expect(Reflect.getMetadata(AUTHENTICATED_ONLY_KEY, proto.voidEntry)).toBe(true);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, proto.voidEntry)).toBeUndefined();
  });

  it('the controller class itself carries no blanket marker (mutation routes are not accidentally opened up)', () => {
    expect(Reflect.getMetadata(AUTHENTICATED_ONLY_KEY, StaffLedgerController)).toBeUndefined();
    expect(Reflect.getMetadata(PERMISSIONS_KEY, StaffLedgerController)).toBeUndefined();
  });
});

// ─── DTO binding pass-through ──────────────────────────────────────────────────

describe('StaffLedgerController — pass-through', () => {
  it('create() forwards the current user and body to the service', async () => {
    const { controller, service } = makeController();
    const dto = { userId: 'employee-001', category: 'BONUS', amount: 1000, effectiveDate: '2026-08-01' } as any;
    const result = await controller.create(user, dto);
    expect(service.create).toHaveBeenCalledWith(user, dto);
    expect(result).toEqual({ id: 'entry-001' });
  });

  it('findForEmployee() forwards user, userId param, and query to the service', async () => {
    const { controller, service } = makeController();
    const query = { page: 1, limit: 20 } as any;
    await controller.findForEmployee(user, 'employee-001', query);
    expect(service.findForEmployee).toHaveBeenCalledWith(user, 'employee-001', query);
  });

  it('approve() forwards user, id param, and body to the service', async () => {
    const { controller, service } = makeController();
    const dto = { version: 0 };
    await controller.approve(user, 'entry-001', dto);
    expect(service.approve).toHaveBeenCalledWith(user, 'entry-001', dto);
  });

  it('voidEntry() forwards user, id param, and body to the service', async () => {
    const { controller, service } = makeController();
    const dto = { version: 0, reason: 'mistake' };
    await controller.voidEntry(user, 'entry-001', dto);
    expect(service.voidEntry).toHaveBeenCalledWith(user, 'entry-001', dto);
  });

  it('reverse() forwards user, id param, and body to the service', async () => {
    const { controller, service } = makeController();
    const dto = { version: 2, reason: 'double-counted' };
    await controller.reverse(user, 'entry-001', dto);
    expect(service.reverse).toHaveBeenCalledWith(user, 'entry-001', dto);
  });

  it('correct() forwards user, id param, and body to the service', async () => {
    const { controller, service } = makeController();
    const dto = { version: 2, reason: 'wrong amount', correctedAmount: 750 };
    await controller.correct(user, 'entry-001', dto);
    expect(service.correct).toHaveBeenCalledWith(user, 'entry-001', dto);
  });
});
