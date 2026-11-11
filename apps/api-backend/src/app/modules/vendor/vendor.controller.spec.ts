import 'reflect-metadata';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { VendorController } from './vendor.controller';

/** Route table of VendorController: declaration order, throttle metadata, and bulk-before-:id. */
const proto = VendorController.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
const routes = Object.getOwnPropertyNames(proto)
  .filter((n) => n !== 'constructor' && Reflect.getMetadata(PATH_METADATA, proto[n]) !== undefined)
  .map((name) => ({
    name,
    path: Reflect.getMetadata(PATH_METADATA, proto[name]) as string,
    method: Reflect.getMetadata(METHOD_METADATA, proto[name]) as number,
  }));

describe('VendorController routes', () => {
  it('bulk routes are declared before any :id route, so :id never captures them', () => {
    const idx = (p: string) => routes.findIndex((r) => r.path === p);
    const firstId = routes.findIndex((r) => r.path.startsWith(':id'));
    expect(idx('bulk/suspend')).toBeGreaterThanOrEqual(0);
    expect(idx('bulk/unsuspend')).toBeGreaterThanOrEqual(0);
    expect(idx('bulk/suspend')).toBeLessThan(firstId);
    expect(idx('bulk/unsuspend')).toBeLessThan(firstId);
  });

  it.each(['reset-admin-password', 'bulk/suspend', 'bulk/unsuspend', 'provision'])('%s is throttled', (suffix) => {
    const r = routes.find((x) => x.path.endsWith(suffix))!;
    const keys = Reflect.getMetadataKeys(proto[r.name]).map(String);
    expect(keys.some((k) => k.startsWith('THROTTLER:LIMIT'))).toBe(true);
  });

  it('reset-admin-password is limited to 1/s and 5/min', () => {
    const r = routes.find((x) => x.path.endsWith('reset-admin-password'))!;
    expect(Reflect.getMetadata('THROTTLER:LIMITshort', proto[r.name])).toBe(1);
    expect(Reflect.getMetadata('THROTTLER:LIMITmedium', proto[r.name])).toBe(5);
  });

  it('there is no bulk delete / wipe / reset route', () => {
    expect(routes.filter((r) => r.path.startsWith('bulk/')).map((r) => r.path).sort()).toEqual(['bulk/suspend', 'bulk/unsuspend']);
  });
});
