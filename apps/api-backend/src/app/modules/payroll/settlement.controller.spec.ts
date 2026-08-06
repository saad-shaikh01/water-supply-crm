import 'reflect-metadata';
import { SettlementController } from './settlement.controller';
import { AUTHENTICATED_ONLY_KEY } from '../../common/decorators/authz-markers.decorator';
import {
  PERMISSIONS_KEY,
  type RequiredPermissionsMeta,
} from '../../common/decorators/require-permissions.decorator';

// ─── fixtures ─────────────────────────────────────────────────────────────────

const user = { userId: 'admin-001', vendorId: 'vendor-001', role: 'VENDOR_ADMIN' } as any;

function makeController() {
  const service = {
    record: jest.fn().mockResolvedValue({ settlement: {}, entry: {}, autoSettled: false }),
    markSettled: jest.fn().mockResolvedValue({ id: 'entry-001' }),
    listForEntry: jest.fn().mockResolvedValue({ settlements: [], remainingBalance: 0 }),
  };
  const controller = new SettlementController(service as any);
  return { controller, service };
}

// ─── authorization metadata ────────────────────────────────────────────────────

describe('SettlementController — authorization metadata', () => {
  const proto = SettlementController.prototype as any;

  const permissionByMethod: Record<string, string> = {
    record: 'payroll:settlement_record',
    markSettled: 'payroll:settlement_record',
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

  it('listForEntry remains open to any authenticated user (self-view scoping is a code-level check, not RBAC)', () => {
    expect(Reflect.getMetadata(AUTHENTICATED_ONLY_KEY, proto.listForEntry)).toBe(true);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, proto.listForEntry)).toBeUndefined();
  });

  it('the controller class itself carries no blanket marker', () => {
    expect(Reflect.getMetadata(AUTHENTICATED_ONLY_KEY, SettlementController)).toBeUndefined();
    expect(Reflect.getMetadata(PERMISSIONS_KEY, SettlementController)).toBeUndefined();
  });
});

// ─── DTO binding pass-through ──────────────────────────────────────────────────

describe('SettlementController — pass-through', () => {
  it('record() forwards user, id param, and dto to the service', async () => {
    const { controller, service } = makeController();
    const dto = { amount: 5000, method: 'CASH' } as any;
    await controller.record(user, 'entry-001', dto);
    expect(service.record).toHaveBeenCalledWith(user, 'entry-001', dto);
  });

  it('markSettled() forwards user, id param, and version to the service', async () => {
    const { controller, service } = makeController();
    const dto = { version: 2 };
    await controller.markSettled(user, 'entry-001', dto);
    expect(service.markSettled).toHaveBeenCalledWith(user, 'entry-001', dto.version);
  });

  it('listForEntry() forwards user and id param to the service', async () => {
    const { controller, service } = makeController();
    await controller.listForEntry(user, 'entry-001');
    expect(service.listForEntry).toHaveBeenCalledWith(user, 'entry-001');
  });
});
