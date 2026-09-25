import 'reflect-metadata';
import { PayrollVendorConfigController } from './payroll-vendor-config.controller';
import { AUTHENTICATED_ONLY_KEY } from '../../common/decorators/authz-markers.decorator';
import { PERMISSIONS_KEY, type RequiredPermissionsMeta } from '../../common/decorators/require-permissions.decorator';

const user = { userId: 'admin-001', vendorId: 'vendor-001', role: 'VENDOR_ADMIN' } as any;

function makeController() {
  const service = {
    getConfig: jest.fn().mockResolvedValue({ cutoffDay: 1, cashCutoffDay: null, cashWindowCategories: [], autoLockEnabled: false }),
    updateConfig: jest.fn().mockResolvedValue({ cutoffDay: 1, cashCutoffDay: 10, cashWindowCategories: ['ADVANCE'], autoLockEnabled: false }),
  };
  const controller = new PayrollVendorConfigController(service as any);
  return { controller, service };
}

describe('PayrollVendorConfigController — authorization metadata', () => {
  const proto = PayrollVendorConfigController.prototype as any;

  it.each(['getConfig', 'updateConfig'])('%s requires exactly payroll:config_manage', (methodName) => {
    const meta = Reflect.getMetadata(PERMISSIONS_KEY, proto[methodName]) as RequiredPermissionsMeta;
    expect(meta).toEqual({ mode: 'all', permissions: ['payroll:config_manage'] });
    expect(Reflect.getMetadata(AUTHENTICATED_ONLY_KEY, proto[methodName])).toBeUndefined();
  });
});

describe('PayrollVendorConfigController — pass-through', () => {
  it('getConfig() forwards the vendor id', async () => {
    const { controller, service } = makeController();
    await controller.getConfig(user);
    expect(service.getConfig).toHaveBeenCalledWith(user.vendorId);
  });

  it('updateConfig() forwards user + dto', async () => {
    const { controller, service } = makeController();
    const dto = { cutoffDay: 1, cashCutoffDay: 10, cashWindowCategories: ['ADVANCE'] } as any;
    await controller.updateConfig(user, dto);
    expect(service.updateConfig).toHaveBeenCalledWith(user, dto);
  });
});
