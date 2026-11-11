import { CacheInvalidationService, CACHE_KEYS } from '@water-supply-crm/caching';


describe('CacheInvalidationService.invalidatePlatformDashboard', () => {
  it('deletes exactly the platform overview key', async () => {
    const cacheManager = { del: jest.fn(async () => true) };
    const svc = new CacheInvalidationService(cacheManager as never);
    await svc.invalidatePlatformDashboard();
    expect(cacheManager.del).toHaveBeenCalledTimes(1);
    expect(cacheManager.del).toHaveBeenCalledWith('platform:dashboard:overview');
    expect(CACHE_KEYS.PLATFORM_DASHBOARD_OVERVIEW).toBe('platform:dashboard:overview');
  });
});
