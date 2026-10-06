import { TrackingService } from './tracking.service';

/** Audit M2: the live (Redis) driver location was returned before any vendor comparison. */
const loc = (vendorId: string) => ({
  driverId: 'driver-1',
  driverName: 'D',
  vendorId,
  latitude: 24.8,
  longitude: 67.0,
  updatedAt: new Date().toISOString(),
});

function service(live: unknown, persisted: unknown) {
  const svc = Object.create(TrackingService.prototype) as TrackingService;
  (svc as any).getDriverLocationFromRedis = jest.fn(async () => live);
  (svc as any).getDriverLocationFromDb = jest.fn(async () => persisted);
  return svc;
}

describe('TrackingService.getDriverLocationResilient tenancy', () => {
  it('returns the live location to the driver\'s own vendor', async () => {
    const res = await service(loc('vendor-a'), null).getDriverLocationResilient('driver-1', 'vendor-a');
    expect(res).toMatchObject({ driverId: 'driver-1', vendorId: 'vendor-a' });
  });

  it('returns null — not the location — when the live record belongs to another vendor', async () => {
    const svc = service(loc('vendor-b'), loc('vendor-b'));
    await expect(svc.getDriverLocationResilient('driver-1', 'vendor-a')).resolves.toBeNull();
  });

  it('does not fall through to the DB copy for a foreign live record', async () => {
    const svc = service(loc('vendor-b'), loc('vendor-a')); // even a (stale) DB row claiming A must not be consulted
    await expect(svc.getDriverLocationResilient('driver-1', 'vendor-a')).resolves.toBeNull();
    expect((svc as any).getDriverLocationFromDb).not.toHaveBeenCalled();
  });

  it('still tenant-checks the DB fallback when there is no live record', async () => {
    await expect(service(null, loc('vendor-b')).getDriverLocationResilient('driver-1', 'vendor-a')).resolves.toBeNull();
    await expect(service(null, loc('vendor-a')).getDriverLocationResilient('driver-1', 'vendor-a')).resolves.toMatchObject({
      vendorId: 'vendor-a',
    });
  });
});
