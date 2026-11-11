import fs from 'node:fs';
import path from 'node:path';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithQuery } from '../../../../test/utils/render';
import { AccountsTable } from './accounts-table';
import { whatsappApi, type WhatsAppAccountRow } from '../api/whatsapp.api';

jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn(), warning: jest.fn() } }));
jest.mock('../api/whatsapp.api', () => ({
  ...jest.requireActual('../api/whatsapp.api'),
  whatsappApi: { list: jest.fn(), assignable: jest.fn(), assign: jest.fn(), unassign: jest.fn(), verify: jest.fn() },
}));

const api = whatsappApi as unknown as Record<'assignable' | 'assign' | 'unassign' | 'verify', jest.Mock>;

const account: WhatsAppAccountRow = {
  id: 'acc1', label: 'Main line', wabaId: 'w', phoneNumberId: 'p', displayNumber: '+92 300 0000000', verifiedName: 'Aqua Co',
  status: 'READY', qualityRating: 'GREEN', lastHealthCheckAt: null, lastHealthError: null, templateSuffix: null, templatesSyncedAt: null,
  vendors: [{ id: 'v1', name: 'Aqua One', isActive: true }],
};
const pagination = { page: 1, limit: 20, total: 1, onPageChange: jest.fn(), onLimitChange: jest.fn() };

describe('AccountsTable', () => {
  it('renders accounts with vendor chips', () => {
    renderWithQuery(<AccountsTable rows={[account]} pagination={pagination} />);
    expect(screen.getByText('Main line')).toBeTruthy();
    expect(screen.getByTestId('vendor-chip').textContent).toContain('Aqua One');
  });

  it('unassign requires confirmation and states the account is not deleted', async () => {
    api.unassign.mockResolvedValue(account);
    renderWithQuery(<AccountsTable rows={[account]} pagination={pagination} />);
    fireEvent.click(screen.getByLabelText('Unassign Aqua One'));
    expect(api.unassign).not.toHaveBeenCalled();
    expect(screen.getByText(/does not delete the account/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Unassign' }));
    await waitFor(() => expect(api.unassign).toHaveBeenCalledWith('acc1', 'v1'));
  });

  it('a 409 on assign opens the replace confirmation, then retries with replace=true', async () => {
    api.assignable.mockResolvedValue([{ id: 'v2', name: 'Blue Co' }]);
    api.assign.mockRejectedValueOnce({ response: { status: 409, data: { code: 'VENDOR_HAS_ACCOUNT' } } });
    api.assign.mockResolvedValueOnce(account);
    renderWithQuery(<AccountsTable rows={[account]} pagination={pagination} />);
    fireEvent.click(screen.getByLabelText('Assign vendor to Main line'));
    await screen.findByText('Blue Co');
    fireEvent.change(screen.getByLabelText('Vendor'), { target: { value: 'v2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Assign' }));
    await screen.findByText('Replace existing account?');
    expect(api.assign).toHaveBeenLastCalledWith('acc1', 'v2', undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Replace' }));
    await waitFor(() => expect(api.assign).toHaveBeenLastCalledWith('acc1', 'v2', true));
  });

  it('verify calls the API', async () => {
    api.verify.mockResolvedValue(account);
    renderWithQuery(<AccountsTable rows={[account]} pagination={pagination} />);
    fireEvent.click(screen.getByLabelText('Verify Main line now'));
    await waitFor(() => expect(api.verify).toHaveBeenCalledWith('acc1'));
  });
});

describe('whatsapp types never model credentials', () => {
  it('contains no token/cipher/secret identifiers', () => {
    const src = fs.readFileSync(path.join(__dirname, '../api/whatsapp.api.ts'), 'utf8');
    expect(src).not.toMatch(/cipher|accessToken|tokenCipher|hasToken|secret|appSecret/i);
  });
});
