import 'reflect-metadata';
import { PayrollSlipController } from './payroll-slip.controller';
import { AUTHENTICATED_ONLY_KEY } from '../../common/decorators/authz-markers.decorator';
import { PERMISSIONS_KEY, type RequiredPermissionsMeta } from '../../common/decorators/require-permissions.decorator';

const user = { userId: 'admin-001', vendorId: 'vendor-001' } as any;

function make() {
  const service = {
    slipPdf: jest.fn().mockResolvedValue({ buffer: Buffer.from('%PDF-x'), filename: 'Salary-Slip-2026-09-Ali.pdf' }),
    status: jest.fn().mockResolvedValue({}),
    preview: jest.fn().mockResolvedValue({}),
    send: jest.fn().mockResolvedValue({}),
    dispatchDetail: jest.fn().mockResolvedValue({}),
  };
  return { controller: new PayrollSlipController(service as any), service };
}

describe('PayrollSlipController — authorization metadata', () => {
  const proto = PayrollSlipController.prototype as any;
  const expected: Record<string, string> = {
    status: 'payroll:view_all',
    downloadSlipPdf: 'payroll:view_all',
    preview: 'payroll:slip_send',
    send: 'payroll:slip_send',
    dispatchDetail: 'payroll:slip_send',
  };

  it.each(Object.entries(expected))('%s requires exactly %s', (method, permission) => {
    const meta = Reflect.getMetadata(PERMISSIONS_KEY, proto[method]) as RequiredPermissionsMeta;
    expect(meta).toEqual({ mode: 'all', permissions: [permission] });
  });

  it.each(Object.keys(expected))('%s is not AUTHENTICATED_ONLY (that would bypass the permission)', (method) => {
    expect(Reflect.getMetadata(AUTHENTICATED_ONLY_KEY, proto[method])).toBeUndefined();
  });

  it('every handler on the controller is gated (no unguarded route sneaks in)', () => {
    const handlers = Object.getOwnPropertyNames(proto).filter((n) => n !== 'constructor');
    expect(handlers.sort()).toEqual(Object.keys(expected).sort());
  });
});

describe('PayrollSlipController — pass-through', () => {
  it('forwards user, periodId and the DTO to the service', async () => {
    const { controller, service } = make();
    await controller.status(user, 'p1');
    await controller.preview(user, 'p1', { entryIds: ['e1'] });
    await controller.send(user, 'p1', { entryIds: ['e1'], confirmResend: true });
    await controller.dispatchDetail(user, 'd1');
    const res = { set: jest.fn(), end: jest.fn() };
    await controller.downloadSlipPdf(user, 'e1', res as any);
    expect(service.slipPdf).toHaveBeenCalledWith(user, 'e1');
    expect(res.set).toHaveBeenCalledWith(expect.objectContaining({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="Salary-Slip-2026-09-Ali.pdf"' }));
    expect(res.end).toHaveBeenCalledWith(Buffer.from('%PDF-x'));
    expect(service.status).toHaveBeenCalledWith(user, 'p1');
    expect(service.preview).toHaveBeenCalledWith(user, 'p1', { entryIds: ['e1'] });
    expect(service.send).toHaveBeenCalledWith(user, 'p1', { entryIds: ['e1'], confirmResend: true });
    expect(service.dispatchDetail).toHaveBeenCalledWith(user, 'd1');
  });
});
