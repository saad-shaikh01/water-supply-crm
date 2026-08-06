import 'reflect-metadata';
import { SalaryStructureController } from './salary-structure.controller';
import { AUTHENTICATED_ONLY_KEY } from '../../common/decorators/authz-markers.decorator';
import {
  PERMISSIONS_KEY,
  type RequiredPermissionsMeta,
} from '../../common/decorators/require-permissions.decorator';

// ─── fixtures ─────────────────────────────────────────────────────────────────

const user = { userId: 'admin-001', vendorId: 'vendor-001', role: 'VENDOR_ADMIN' } as any;

function makeController() {
  const service = {
    create: jest.fn().mockResolvedValue({ id: 'structure-001' }),
    listHistory: jest.fn().mockResolvedValue([{ id: 'structure-001' }]),
    getEffectiveOn: jest.fn().mockResolvedValue({ id: 'structure-001' }),
  };
  const controller = new SalaryStructureController(service as any);
  return { controller, service };
}

// ─── authorization metadata ────────────────────────────────────────────────────
//
// The single global PermissionsGuard resolves PERMISSIONS_KEY /
// AUTHENTICATED_ONLY_KEY via `Reflector.getAllAndOverride([handler, class])`.
// These assertions pin down exactly what that guard will see for each route —
// see the module-level doc comment on SalaryStructureController.

describe('SalaryStructureController — authorization metadata', () => {
  const proto = SalaryStructureController.prototype as any;

  it('create requires exactly payroll:salary_structure_manage', () => {
    const meta = Reflect.getMetadata(PERMISSIONS_KEY, proto.create) as RequiredPermissionsMeta;
    expect(meta).toEqual({ mode: 'all', permissions: ['payroll:salary_structure_manage'] });
  });

  it('create does NOT carry AUTHENTICATED_ONLY (which would bypass the permission check)', () => {
    expect(Reflect.getMetadata(AUTHENTICATED_ONLY_KEY, proto.create)).toBeUndefined();
  });

  it.each(['listHistory', 'getEffective'])(
    '%s remains open to any authenticated user (self-view scoping is a code-level check, not RBAC)',
    (methodName) => {
      expect(Reflect.getMetadata(AUTHENTICATED_ONLY_KEY, proto[methodName])).toBe(true);
      expect(Reflect.getMetadata(PERMISSIONS_KEY, proto[methodName])).toBeUndefined();
    },
  );

  it('the controller class itself carries no blanket marker (the mutation route is not accidentally opened up)', () => {
    expect(Reflect.getMetadata(AUTHENTICATED_ONLY_KEY, SalaryStructureController)).toBeUndefined();
    expect(Reflect.getMetadata(PERMISSIONS_KEY, SalaryStructureController)).toBeUndefined();
  });
});

// ─── DTO binding pass-through ──────────────────────────────────────────────────

describe('SalaryStructureController — pass-through', () => {
  it('create() forwards the current user and body to the service', async () => {
    const { controller, service } = makeController();
    const dto = { userId: 'employee-001', baseAmount: 30000, effectiveFrom: '2026-08-01' } as any;
    const result = await controller.create(user, dto);
    expect(service.create).toHaveBeenCalledWith(user, dto);
    expect(result).toEqual({ id: 'structure-001' });
  });

  it('listHistory() forwards user and userId param to the service', async () => {
    const { controller, service } = makeController();
    await controller.listHistory(user, 'employee-001');
    expect(service.listHistory).toHaveBeenCalledWith(user, 'employee-001');
  });

  it('getEffective() forwards user, userId param, and query to the service', async () => {
    const { controller, service } = makeController();
    const query = { date: '2026-08-05' } as any;
    await controller.getEffective(user, 'employee-001', query);
    expect(service.getEffectiveOn).toHaveBeenCalledWith(user, 'employee-001', query.date);
  });
});
