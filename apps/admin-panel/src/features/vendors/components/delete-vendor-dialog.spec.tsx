import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithQuery } from '../../../../test/utils/render';
import { DeleteVendorDialog } from './delete-vendor-dialog';
import { vendorsApi } from '../api/vendors.api';

jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
jest.mock('../api/vendors.api', () => ({ vendorsApi: { remove: jest.fn(), suspend: jest.fn() }, vendorWipeApi: {} }));

const api = vendorsApi as unknown as Record<string, jest.Mock>;
const vendor = { id: 'v1', name: 'Aqua One', slug: 'aqua-one', isActive: true };

const confirmBtn = () => screen.getByRole('button', { name: 'Delete vendor' }) as HTMLButtonElement;

describe('DeleteVendorDialog (FE-12)', () => {
  it('delete stays disabled until the exact slug is typed', async () => {
    api.remove.mockResolvedValue({});
    const onOpenChange = jest.fn();
    renderWithQuery(<DeleteVendorDialog vendor={vendor} onOpenChange={onOpenChange} />);
    expect(confirmBtn().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Type/), { target: { value: 'aqua' } });
    expect(confirmBtn().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Type/), { target: { value: 'aqua-one' } });
    expect(confirmBtn().disabled).toBe(false);
    fireEvent.click(confirmBtn());
    await waitFor(() => expect(api.remove).toHaveBeenCalledWith('v1'));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('a 409 shows the API message with the blockers list and a "Suspend instead" action', async () => {
    api.remove.mockRejectedValue({
      response: { status: 409, data: { message: 'Cannot delete vendor - it has business records that must be kept: Expense (3). Suspend the vendor instead, or use the wipe flow.', blockers: [{ entity: 'Expense', count: 3 }, { entity: 'Payroll', count: null }] } },
    });
    api.suspend.mockResolvedValue({});
    renderWithQuery(<DeleteVendorDialog vendor={vendor} onOpenChange={jest.fn()} />);
    fireEvent.change(screen.getByLabelText(/Type/), { target: { value: 'aqua-one' } });
    fireEvent.click(confirmBtn());
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Cannot delete vendor');
    expect(alert.textContent).toContain('Expense (3)');
    expect(alert.querySelectorAll('li')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Suspend instead' }));
    await waitFor(() => expect(api.suspend).toHaveBeenCalledWith('v1'));
  });

  it('a 400 (transactions exist) is surfaced through apiErrorMessage', async () => {
    api.remove.mockRejectedValue({ response: { status: 400, data: { message: 'Cannot delete vendor - 12 transaction(s) exist. Suspend instead.' } } });
    renderWithQuery(<DeleteVendorDialog vendor={vendor} onOpenChange={jest.fn()} />);
    fireEvent.change(screen.getByLabelText(/Type/), { target: { value: 'aqua-one' } });
    fireEvent.click(confirmBtn());
    expect((await screen.findByRole('alert')).textContent).toContain('12 transaction(s) exist');
  });

  it('no "Suspend instead" for a vendor that is already suspended', async () => {
    api.remove.mockRejectedValue({ response: { status: 409, data: { message: 'blocked', blockers: [] } } });
    renderWithQuery(<DeleteVendorDialog vendor={{ ...vendor, isActive: false }} onOpenChange={jest.fn()} />);
    fireEvent.change(screen.getByLabelText(/Type/), { target: { value: 'aqua-one' } });
    fireEvent.click(confirmBtn());
    await screen.findByRole('alert');
    expect(screen.queryByRole('button', { name: 'Suspend instead' })).toBeNull();
  });
});
