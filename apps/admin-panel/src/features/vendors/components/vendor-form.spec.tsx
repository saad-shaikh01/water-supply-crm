import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithQuery } from '../../../../test/utils/render';
import { VendorForm } from './vendor-form';
import { vendorsApi } from '../api/vendors.api';

jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
jest.mock('../api/vendors.api', () => ({
  vendorsApi: { update: jest.fn() },
  vendorWipeApi: {},
}));

const update = vendorsApi.update as jest.Mock;
const vendor = { id: 'v1', name: 'Aqua One', slug: 'aqua-one', address: 'Main St', raastId: '' };

describe('VendorForm (edit, F6 regression)', () => {
  it('PATCH body never contains slug', async () => {
    update.mockResolvedValue({});
    renderWithQuery(<VendorForm open onOpenChange={jest.fn()} vendor={vendor} />);
    fireEvent.change(await screen.findByLabelText('Vendor Name'), { target: { value: 'Aqua Two' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update' }));
    await waitFor(() => expect(update).toHaveBeenCalled());
    const [id, body] = update.mock.calls[0];
    expect(id).toBe('v1');
    expect(body).toEqual({ name: 'Aqua Two' });
    expect(body).not.toHaveProperty('slug');
  });

  it('sends changed optional fields only', async () => {
    update.mockResolvedValue({});
    renderWithQuery(<VendorForm open onOpenChange={jest.fn()} vendor={vendor} />);
    fireEvent.change(await screen.findByLabelText('Address'), { target: { value: 'New St' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update' }));
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0][1]).toEqual({ name: 'Aqua One', address: 'New St' });
  });

  it('renders the slug read-only', async () => {
    renderWithQuery(<VendorForm open onOpenChange={jest.fn()} vendor={vendor} />);
    const slug = (await screen.findByLabelText('Slug')) as HTMLInputElement;
    expect(slug.readOnly).toBe(true);
    expect(slug.value).toBe('aqua-one');
  });
});
