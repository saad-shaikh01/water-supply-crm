import 'reflect-metadata';
import { PayrollEntryController } from './payroll-entry.controller';
import { AUTHENTICATED_ONLY_KEY } from '../../common/decorators/authz-markers.decorator';
import {
  PERMISSIONS_KEY,
  type RequiredPermissionsMeta,
} from '../../common/decorators/require-permissions.decorator';

// ─── fixtures ─────────────────────────────────────────────────────────────────

const user = { userId: 'admin-001', vendorId: 'vendor-001', role: 'VENDOR_ADMIN' } as any;

function makeController() {
  const service = {
    generateDraft: jest.fn().mockResolvedValue({ generated: [], regenerated: [] }),
    listForPeriod: jest.fn().mockResolvedValue([]),
    getBreakdown: jest.fn().mockResolvedValue({ entry: {}, ledgerEntriesByBucket: {} }),
    approveEntry: jest.fn().mockResolvedValue({ id: 'entry-001' }),
    recalculateEntry: jest.fn().mockResolvedValue({ id: 'entry-001' }),
  };
  const exporter = {
    exportPeriodCsv: jest.fn().mockResolvedValue({ filename: 'payroll-2026-09.csv', body: '﻿a,b\r\n', truncated: false }),
  };
  const controller = new PayrollEntryController(service as any, exporter as any);
  return { controller, service, exporter };
}

// ─── authorization metadata ────────────────────────────────────────────────────

describe('PayrollEntryController — authorization metadata', () => {
  const proto = PayrollEntryController.prototype as any;

  const permissionByMethod: Record<string, string> = {
    generateDraft: 'payroll:period_generate',
    listForPeriod: 'payroll:view_all',
    exportPeriodCsv: 'payroll:view_all',
    approveEntry: 'payroll:entry_approve',
    recalculateEntry: 'payroll:entry_approve',
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

  it('getBreakdown remains open to any authenticated user (self-view scoping is a code-level check, not RBAC)', () => {
    expect(Reflect.getMetadata(AUTHENTICATED_ONLY_KEY, proto.getBreakdown)).toBe(true);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, proto.getBreakdown)).toBeUndefined();
  });

  it('the controller class itself carries no blanket marker', () => {
    expect(Reflect.getMetadata(AUTHENTICATED_ONLY_KEY, PayrollEntryController)).toBeUndefined();
    expect(Reflect.getMetadata(PERMISSIONS_KEY, PayrollEntryController)).toBeUndefined();
  });
});

// ─── DTO binding pass-through ──────────────────────────────────────────────────

describe('PayrollEntryController — pass-through', () => {
  it('generateDraft() forwards user and periodId param to the service', async () => {
    const { controller, service } = makeController();
    await controller.generateDraft(user, 'period-001');
    expect(service.generateDraft).toHaveBeenCalledWith(user, 'period-001');
  });

  it('listForPeriod() forwards user and periodId param to the service', async () => {
    const { controller, service } = makeController();
    await controller.listForPeriod(user, 'period-001');
    expect(service.listForPeriod).toHaveBeenCalledWith(user, 'period-001');
  });

  it('exportPeriodCsv() forwards user + periodId and writes the CSV headers and body', async () => {
    const { controller, exporter } = makeController();
    const res = { set: jest.fn(), end: jest.fn() };
    await controller.exportPeriodCsv(user, 'period-001', res as any);
    expect(exporter.exportPeriodCsv).toHaveBeenCalledWith(user, 'period-001');
    expect(res.set).toHaveBeenCalledWith(
      expect.objectContaining({
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="payroll-2026-09.csv"',
      }),
    );
    expect(res.end).toHaveBeenCalledWith('﻿a,b\r\n');
  });

  it('getBreakdown() forwards user and id param to the service', async () => {
    const { controller, service } = makeController();
    await controller.getBreakdown(user, 'entry-001');
    expect(service.getBreakdown).toHaveBeenCalledWith(user, 'entry-001');
  });

  it('approveEntry() forwards user, id param, and version to the service', async () => {
    const { controller, service } = makeController();
    const dto = { version: 1 };
    await controller.approveEntry(user, 'entry-001', dto);
    expect(service.approveEntry).toHaveBeenCalledWith(user, 'entry-001', dto.version, false);
  });

  it('approveEntry() forwards the pending-absence acknowledgement only when it is exactly true', async () => {
    const { controller, service } = makeController();
    await controller.approveEntry(user, 'entry-001', { version: 1, acknowledgePendingAbsences: true });
    expect(service.approveEntry).toHaveBeenLastCalledWith(user, 'entry-001', 1, true);
    await controller.approveEntry(user, 'entry-001', { version: 1, acknowledgePendingAbsences: false });
    expect(service.approveEntry).toHaveBeenLastCalledWith(user, 'entry-001', 1, false);
  });

  it('recalculateEntry() forwards user, id param, and version to the service', async () => {
    const { controller, service } = makeController();
    const dto = { version: 1 };
    await controller.recalculateEntry(user, 'entry-001', dto);
    expect(service.recalculateEntry).toHaveBeenCalledWith(user, 'entry-001', dto.version);
  });
});
