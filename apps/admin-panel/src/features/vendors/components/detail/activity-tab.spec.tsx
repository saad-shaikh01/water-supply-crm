import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithQuery } from '../../../../../test/utils/render';
import { ActivityTab } from './activity-tab';
import { vendorDetailApi } from '../../api/vendor-detail.api';

jest.mock('../../api/vendor-detail.api', () => ({ vendorDetailApi: { getAudit: jest.fn() } }));

const getAudit = vendorDetailApi.getAudit as jest.Mock;
const vendor = { id: 'v1', name: 'Aqua One', slug: 'aqua-one', isActive: true };

const row = (over: Record<string, unknown>) => ({ id: 'r', vendorId: 'v1', userId: 'u', userName: 'Super Admin', action: 'UPDATE', entity: 'Vendor', entityId: 'v1', changes: null, createdAt: '2026-03-01T10:00:00Z', ...over });

describe('ActivityTab', () => {
  it('queries the vendor audit with the entity whitelist and shows actor, action, entity and reason', async () => {
    getAudit.mockResolvedValue({
      data: [row({ id: '1', action: 'RESET_ADMIN_PASSWORD', entity: 'User', changes: { reason: 'locked out' } }), row({ id: '2', userName: null, action: 'CREATE' })],
      meta: { total: 2, page: 1, limit: 20 },
    });
    renderWithQuery(<ActivityTab vendor={vendor as never} />);
    await screen.findByText('RESET_ADMIN_PASSWORD', { selector: 'div' });
    expect(getAudit).toHaveBeenCalledWith(expect.objectContaining({ vendorId: 'v1', entities: 'Vendor,User,VendorBranding', page: 1 }));
    expect(screen.getByText('locked out')).toBeTruthy();
    expect(screen.getByText('System')).toBeTruthy();
    expect(screen.getByText('CREATE', { selector: 'div' })).toBeTruthy();
  });

  it('redacts password / token / secret / hash keys in the expanded JSON', async () => {
    getAudit.mockResolvedValue({
      data: [row({ id: '1', changes: { before: { name: 'Old', passwordHash: 'HASHVALUE' }, after: { name: 'New', refreshToken: 'TOKENVALUE', apiSecret: 'SECRETVALUE', newPassword: 'PLAINTEXT' } } })],
      meta: { total: 1, page: 1, limit: 20 },
    });
    renderWithQuery(<ActivityTab vendor={vendor as never} />);
    fireEvent.click(await screen.findByText('Show changes'));
    const pre = document.querySelector('pre') as HTMLElement;
    expect(pre.textContent).toContain('"name": "New"');
    expect(pre.textContent).toContain('[redacted]');
    for (const leaked of ['HASHVALUE', 'TOKENVALUE', 'SECRETVALUE', 'PLAINTEXT']) expect(document.body.textContent).not.toContain(leaked);
  });

  it('action filter is sent to the API and resets paging', async () => {
    getAudit.mockResolvedValue({ data: [row({ id: '1' })], meta: { total: 1, page: 1, limit: 20 } });
    renderWithQuery(<ActivityTab vendor={vendor as never} />);
    await screen.findByText('Super Admin');
    fireEvent.change(screen.getByLabelText('Filter by action'), { target: { value: 'GO_LIVE' } });
    await waitFor(() => expect(getAudit).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'GO_LIVE', page: 1 })));
  });

  it('date range is sent as from / end-of-day to', async () => {
    getAudit.mockResolvedValue({ data: [], meta: { total: 0, page: 1, limit: 20 } });
    renderWithQuery(<ActivityTab vendor={vendor as never} />);
    await screen.findByText('No activity yet');
    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-03-01' } });
    fireEvent.change(screen.getByLabelText('To date'), { target: { value: '2026-03-02' } });
    await waitFor(() => expect(getAudit).toHaveBeenLastCalledWith(expect.objectContaining({ from: '2026-03-01', to: '2026-03-02T23:59:59.999Z' })));
  });
});
