import 'reflect-metadata';
import { UserRole } from '@prisma/client';
import { REQUIRE_ROLE_KEY } from '../../common/decorators/authz-markers.decorator';
import { PlatformAuditController } from './platform-audit.controller';
import { PlatformHealthController } from './platform-health.controller';
import { PlatformImportsController } from './platform-imports.controller';
import { PlatformWhatsAppController } from '../whatsapp/platform-whatsapp.controller';

describe('platform controllers authz metadata', () => {
  it.each([
    ['audit', PlatformAuditController],
    ['health', PlatformHealthController],
    ['imports', PlatformImportsController],
    ['whatsapp', PlatformWhatsAppController],
  ])('%s controller is SUPER_ADMIN only at class level', (_n, ctl) => {
    expect(Reflect.getMetadata(REQUIRE_ROLE_KEY, ctl)).toEqual([UserRole.SUPER_ADMIN]);
  });

  it('route prefixes are under /platform', () => {
    for (const c of [PlatformAuditController, PlatformHealthController, PlatformImportsController, PlatformWhatsAppController]) {
      expect(Reflect.getMetadata('path', c)).toMatch(/^platform\//);
    }
  });

  it('export.csv is throttled (3/min) and audits EXPORT', async () => {
    const proto = PlatformAuditController.prototype;
    const keys = Reflect.getMetadataKeys(proto.exportCsv).filter((k: string) => String(k).startsWith('THROTTLER'));
    expect(keys.length).toBeGreaterThan(0);
    expect(Reflect.getMetadata('THROTTLER:LIMITmedium', proto.exportCsv)).toBe(3);

    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const service = {
      prepareExport: jest.fn().mockResolvedValue({ where: {}, total: 1, truncated: false }),
      exportChunks: async function* () { yield 'h\r\n'; },
    };
    const ctl = new PlatformAuditController(service as never, audit as never);
    const res = { status: jest.fn(), set: jest.fn(), write: jest.fn(), end: jest.fn() };
    await ctl.exportCsv({ userId: 'u', name: 'N' } as never, { vendorId: 'x', page: 1 } as never, res as never);
    expect(res.set).toHaveBeenCalledWith(expect.objectContaining({ 'X-Export-Truncated': 'false' }));
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'EXPORT', entity: 'AuditLog', userId: 'u' }));
    expect(res.end).toHaveBeenCalled();
  });
});
