import { apiClient } from '@water-supply-crm/data-access';
import { vendorDetailApi } from './vendor-detail.api';
import { vendorsApi, vendorWipeApi } from './vendors.api';

jest.mock('@water-supply-crm/data-access', () => ({
  apiClient: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

const c = apiClient as unknown as Record<'get' | 'post' | 'put' | 'patch' | 'delete', jest.Mock>;
const ok = (data: unknown = {}) => Promise.resolve({ data });

beforeEach(() => {
  Object.values(c).forEach((m) => m.mockReset().mockReturnValue(ok()));
});

describe('vendorDetailApi', () => {
  it('getStats', async () => {
    c.get.mockReturnValue(ok({ stats: 1 }));
    expect(await vendorDetailApi.getStats('v1')).toEqual({ stats: 1 });
    expect(c.get).toHaveBeenCalledWith('/vendors/v1/stats');
  });

  it('getUsers drops empty params', async () => {
    await vendorDetailApi.getUsers('v1', { page: 2, limit: 20, role: undefined, search: '' });
    expect(c.get).toHaveBeenCalledWith('/vendors/v1/users', { params: { page: 2, limit: 20 } });
  });

  it('provision', async () => {
    await vendorDetailApi.provision('v1');
    expect(c.post).toHaveBeenCalledWith('/vendors/v1/provision');
  });

  it('resetAdminPassword posts the exact body', async () => {
    const body = { newPassword: 'abc12345', superAdminPassword: 'x', adminUserId: 'u1', reason: 'r' };
    await vendorDetailApi.resetAdminPassword('v1', body);
    expect(c.post).toHaveBeenCalledWith('/vendors/v1/reset-admin-password', body);
  });

  it('getReadiness / goLive / goOffline', async () => {
    await vendorDetailApi.getReadiness('v1');
    expect(c.get).toHaveBeenCalledWith('/vendors/v1/readiness');
    await vendorDetailApi.goLive('v1');
    expect(c.post).toHaveBeenLastCalledWith('/vendors/v1/go-live', {});
    await vendorDetailApi.goLive('v1', true);
    expect(c.post).toHaveBeenLastCalledWith('/vendors/v1/go-live', { force: true });
    await vendorDetailApi.goOffline('v1', 'maintenance');
    expect(c.post).toHaveBeenLastCalledWith('/vendors/v1/go-offline', { reason: 'maintenance' });
    await vendorDetailApi.goOffline('v1');
    expect(c.post).toHaveBeenLastCalledWith('/vendors/v1/go-offline', {});
  });

  it('branding get/save/images/preview', async () => {
    await vendorDetailApi.getBranding('v1');
    expect(c.get).toHaveBeenCalledWith('/vendors/v1/branding');
    const body = { displayName: 'A', paymentAccounts: [] };
    await vendorDetailApi.saveBranding('v1', body);
    expect(c.put).toHaveBeenCalledWith('/vendors/v1/branding', body);

    const file = new File(['x'], 'logo.png', { type: 'image/png' });
    await vendorDetailApi.uploadBrandingImage('v1', 'logo', file);
    const [url, form] = c.post.mock.calls[c.post.mock.calls.length - 1];
    expect(url).toBe('/vendors/v1/branding/image/logo');
    expect((form as FormData).get('file')).toBeInstanceOf(File);

    await vendorDetailApi.deleteBrandingImage('v1', 'icon');
    expect(c.delete).toHaveBeenCalledWith('/vendors/v1/branding/image/icon');

    await vendorDetailApi.previewBranding('v1', 'statement', body);
    expect(c.post).toHaveBeenLastCalledWith('/vendors/v1/branding/preview', body, { params: { doc: 'statement' }, responseType: 'blob' });
  });

  it('getAudit passes vendorId and filters', async () => {
    await vendorDetailApi.getAudit({ vendorId: 'v1', page: 1, limit: 20, action: 'GO_LIVE', entities: 'Vendor,User', from: '' });
    expect(c.get).toHaveBeenCalledWith('/audit-logs', { params: { vendorId: 'v1', page: 1, limit: 20, action: 'GO_LIVE', entities: 'Vendor,User' } });
  });
});

describe('vendorsApi', () => {
  it('getAll sends only the filled filters', async () => {
    await vendorsApi.getAll({ page: 1, limit: 10, search: '', status: 'suspended', sort: 'name', order: 'asc' });
    expect(c.get).toHaveBeenCalledWith('/vendors', { params: { page: 1, limit: 10, status: 'suspended', sort: 'name', order: 'asc' } });
  });

  it('create / update / remove / getOne', async () => {
    const body = { name: 'A', slug: 'a-a', adminName: 'B', adminEmail: 'b@a.com', adminPassword: 'abcd1234' };
    await vendorsApi.create(body);
    expect(c.post).toHaveBeenCalledWith('/vendors', body);
    await vendorsApi.update('v1', { name: 'N' });
    expect(c.patch).toHaveBeenCalledWith('/vendors/v1', { name: 'N' });
    await vendorsApi.remove('v1');
    expect(c.delete).toHaveBeenCalledWith('/vendors/v1');
    await vendorsApi.getOne('v1');
    expect(c.get).toHaveBeenCalledWith('/vendors/v1');
  });

  it('suspend / unsuspend with and without reason', async () => {
    await vendorsApi.suspend('v1', 'why');
    expect(c.patch).toHaveBeenLastCalledWith('/vendors/v1/suspend', { reason: 'why' });
    await vendorsApi.unsuspend('v1');
    expect(c.patch).toHaveBeenLastCalledWith('/vendors/v1/unsuspend', {});
  });

  it('bulk suspend / unsuspend', async () => {
    await vendorsApi.bulkSuspend(['a', 'b'], 'r');
    expect(c.post).toHaveBeenLastCalledWith('/vendors/bulk/suspend', { vendorIds: ['a', 'b'], reason: 'r' });
    await vendorsApi.bulkUnsuspend(['a']);
    expect(c.post).toHaveBeenLastCalledWith('/vendors/bulk/unsuspend', { vendorIds: ['a'] });
  });

  it('wipe client keeps the long timeout', async () => {
    await vendorWipeApi.wipe({ id: 'v1', confirmSlug: 's', password: 'p', acknowledgeBackup: true, previewToken: 't' });
    expect(c.post).toHaveBeenCalledWith('/vendors/v1/wipe', { confirmSlug: 's', password: 'p', acknowledgeBackup: true, previewToken: 't' }, { timeout: 900000 });
  });
});
