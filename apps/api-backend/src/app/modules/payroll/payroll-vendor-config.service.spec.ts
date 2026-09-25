import { PayrollVendorConfigService } from './payroll-vendor-config.service';
import { StaffLedgerCategory } from '@prisma/client';

const VENDOR_ID = 'vendor-1';
const USER = { vendorId: VENDOR_ID, userId: 'admin-1', name: 'Admin' } as any;

function makeService(row: any = null) {
  const prisma: any = {
    payrollVendorConfig: {
      findUnique: jest.fn().mockResolvedValue(row),
      upsert: jest.fn().mockImplementation(async ({ create, update }: any) => ({
        id: row?.id ?? 'config-1',
        ...create,
        ...update,
      })),
    },
  };
  const audit: any = { log: jest.fn().mockResolvedValue(undefined) };
  return { service: new PayrollVendorConfigService(prisma, audit), prisma, audit };
}

describe('PayrollVendorConfigService', () => {
  describe('getConfig()', () => {
    it('returns the documented defaults (calendar-month, cash window disabled) when the vendor has no row yet', async () => {
      const { service } = makeService(null);
      const config = await service.getConfig(VENDOR_ID);
      expect(config).toEqual({ cutoffDay: 1, cashCutoffDay: null, cashWindowCategories: [], autoLockEnabled: false });
    });

    it('returns the stored row as-is when one exists', async () => {
      const { service } = makeService({
        cutoffDay: 10,
        cashCutoffDay: 10,
        cashWindowCategories: [StaffLedgerCategory.ADVANCE, StaffLedgerCategory.CREW_CASH],
        autoLockEnabled: true,
      });
      const config = await service.getConfig(VENDOR_ID);
      expect(config).toEqual({
        cutoffDay: 10,
        cashCutoffDay: 10,
        cashWindowCategories: [StaffLedgerCategory.ADVANCE, StaffLedgerCategory.CREW_CASH],
        autoLockEnabled: true,
      });
    });
  });

  describe('updateConfig()', () => {
    it('upserts the vendor row and audits the change', async () => {
      const { service, prisma, audit } = makeService();
      const dto = {
        cutoffDay: 1,
        cashCutoffDay: 10,
        cashWindowCategories: [StaffLedgerCategory.ADVANCE, StaffLedgerCategory.ADVANCE_RECOVERY, StaffLedgerCategory.CREW_CASH],
      } as any;

      const result = await service.updateConfig(USER, dto);

      expect(prisma.payrollVendorConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { vendorId: VENDOR_ID },
          create: expect.objectContaining({ vendorId: VENDOR_ID, ...dto, updatedById: USER.userId }),
          update: expect.objectContaining({ ...dto, updatedById: USER.userId }),
        }),
      );
      expect(result.cashCutoffDay).toBe(10);
      expect(result.cashWindowCategories).toEqual(dto.cashWindowCategories);
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ vendorId: VENDOR_ID, action: 'UPDATE_PAYROLL_VENDOR_CONFIG', entity: 'PayrollVendorConfig' }),
      );
    });

    it('can null out cashCutoffDay to disable the dual-window feature again', async () => {
      const { service, prisma } = makeService({ cutoffDay: 10, cashCutoffDay: 10, cashWindowCategories: [StaffLedgerCategory.ADVANCE] });
      const dto = { cutoffDay: 10, cashCutoffDay: null, cashWindowCategories: [] } as any;

      const result = await service.updateConfig(USER, dto);

      expect(prisma.payrollVendorConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: expect.objectContaining({ cashCutoffDay: null, cashWindowCategories: [] }) }),
      );
      expect(result.cashCutoffDay).toBeNull();
    });
  });
});
