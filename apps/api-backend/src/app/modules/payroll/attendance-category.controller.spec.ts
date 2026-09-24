import 'reflect-metadata';
import { AttendanceCategoryController } from './attendance-category.controller';
import { AUTHENTICATED_ONLY_KEY } from '../../common/decorators/authz-markers.decorator';
import { PERMISSIONS_KEY, type RequiredPermissionsMeta } from '../../common/decorators/require-permissions.decorator';

const user = { userId: 'manager-001', vendorId: 'vendor-001', role: 'STAFF' } as any;

function makeController() {
  const service = {
    list: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockResolvedValue({ id: 'cat-001' }),
    remove: jest.fn().mockResolvedValue({ deleted: true }),
  };
  const controller = new AttendanceCategoryController(service as any);
  return { controller, service };
}

describe('AttendanceCategoryController — authorization metadata', () => {
  const proto = AttendanceCategoryController.prototype as any;

  it.each(['list', 'create', 'remove'])('%s requires exactly payroll:attendance_mark', (methodName) => {
    const meta = Reflect.getMetadata(PERMISSIONS_KEY, proto[methodName]) as RequiredPermissionsMeta;
    expect(meta).toEqual({ mode: 'all', permissions: ['payroll:attendance_mark'] });
    expect(Reflect.getMetadata(AUTHENTICATED_ONLY_KEY, proto[methodName])).toBeUndefined();
  });
});

describe('AttendanceCategoryController — pass-through', () => {
  it('list() forwards the vendor id', async () => {
    const { controller, service } = makeController();
    await controller.list(user);
    expect(service.list).toHaveBeenCalledWith(user.vendorId);
  });

  it('create() forwards user + dto', async () => {
    const { controller, service } = makeController();
    const dto = { name: 'Office — other business' } as any;
    await controller.create(user, dto);
    expect(service.create).toHaveBeenCalledWith(user, dto);
  });

  it('remove() forwards user + id', async () => {
    const { controller, service } = makeController();
    await controller.remove(user, 'cat-001');
    expect(service.remove).toHaveBeenCalledWith(user, 'cat-001');
  });
});
