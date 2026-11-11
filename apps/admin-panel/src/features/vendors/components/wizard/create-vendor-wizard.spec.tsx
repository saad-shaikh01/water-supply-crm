import { screen, fireEvent, waitFor } from '@testing-library/react';
import { navigationMockFactory, routerMock } from '../../../../../test/mocks/next-navigation';
import { renderWithQuery } from '../../../../../test/utils/render';
import { CreateVendorWizard } from './create-vendor-wizard';
import { vendorsApi } from '../../api/vendors.api';

jest.mock('next/navigation', () => navigationMockFactory());
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
jest.mock('../../api/vendors.api', () => ({ vendorsApi: { create: jest.fn() }, vendorWipeApi: {} }));

const create = vendorsApi.create as jest.Mock;
const result = {
  vendor: { id: 'v9', name: 'Acme Water', slug: 'acme-water' },
  admin: { id: 'a9', email: 'jo@acme.com', name: 'Jo', role: 'VENDOR_ADMIN' },
  provisioning: { summary: { rolesCreated: 4, usersBackfilled: 0, customerFlagCategoriesSeeded: 6 } },
};

const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));

const company = async () => {
  type('Vendor name', 'Acme Water');
  type('Slug', 'acme-water');
  click('Next');
  await screen.findByLabelText('Admin name');
};
const admin = async () => {
  type('Admin name', 'Jo');
  type('Admin email', 'Jo@Acme.com');
  type('Admin password', 'Passw0rd99');
  click('Next');
  await screen.findByText('Create Vendor');
};

const renderWizard = () => renderWithQuery(<CreateVendorWizard open onOpenChange={jest.fn()} />);

describe('CreateVendorWizard', () => {
  it('step 1 blocks on an invalid slug and a missing name', async () => {
    renderWizard();
    type('Slug', 'Bad Slug');
    click('Next');
    await screen.findByText('Vendor name is required');
    expect(screen.getByText(/Slug: lowercase letters/)).toBeTruthy();
    expect(screen.queryByLabelText('Admin name')).toBeNull();
  });

  it('step 2 validates the email and password strength', async () => {
    renderWizard();
    await company();
    type('Admin name', 'Jo');
    type('Admin email', 'nope');
    type('Admin password', 'abcdefgh');
    click('Next');
    await screen.findByText('Valid email required');
    expect(screen.getByText('Password must contain at least one letter and one digit')).toBeTruthy();
  });

  it('happy path: review -> create with the exact body -> result with provisioning summary -> Open vendor', async () => {
    create.mockResolvedValue(result);
    renderWizard();
    await company();
    await admin();
    expect(screen.getByText('jo@acme.com')).toBeTruthy(); // lowercased in review
    click('Create Vendor');
    await screen.findByLabelText('Provisioning summary');
    expect(create).toHaveBeenCalledWith({ name: 'Acme Water', slug: 'acme-water', adminName: 'Jo', adminEmail: 'jo@acme.com', adminPassword: 'Passw0rd99' });
    expect(screen.getByLabelText('Provisioning summary').textContent).toContain('Roles Created');
    click('Open vendor');
    expect(routerMock.push).toHaveBeenCalledWith('/vendors/v9?tab=readiness');
    // the password never appears as text on the result step
    expect(document.body.textContent).not.toContain('Passw0rd99');
  });

  it('double submit sends exactly one request', async () => {
    let resolve: (v: unknown) => void = () => undefined;
    create.mockReturnValue(new Promise((r) => (resolve = r)));
    renderWizard();
    await company();
    await admin();
    const btn = screen.getByRole('button', { name: 'Create Vendor' });
    fireEvent.click(btn);
    fireEvent.click(btn);
    fireEvent.click(btn);
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    resolve(result);
    await screen.findByLabelText('Provisioning summary');
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('a duplicate-slug 409 returns to step 1 with the message on the slug field', async () => {
    create.mockRejectedValue({ response: { status: 409, data: { message: 'Vendor with this slug already exists' } } });
    renderWizard();
    await company();
    await admin();
    click('Create Vendor');
    await screen.findByText('Vendor with this slug already exists');
    expect((screen.getByLabelText('Slug') as HTMLInputElement).value).toBe('acme-water');
    expect(screen.queryByLabelText('Admin name')).toBeNull();
  });

  it('a duplicate-email 409 returns to step 2', async () => {
    create.mockRejectedValue({ response: { status: 409, data: { message: 'User with this email already exists' } } });
    renderWizard();
    await company();
    await admin();
    click('Create Vendor');
    await screen.findByText('User with this email already exists');
    expect(screen.getByLabelText('Admin email')).toBeTruthy();
  });

  it('a non-409 error stays on review and is shown', async () => {
    create.mockRejectedValue({ response: { status: 500, data: { message: 'boom' } } });
    renderWizard();
    await company();
    await admin();
    click('Create Vendor');
    expect((await screen.findByRole('alert')).textContent).toContain('boom');
    expect(screen.getByRole('button', { name: 'Create Vendor' })).toBeTruthy();
  });

  it('Generate fills a valid password that passes step 2', async () => {
    renderWizard();
    await company();
    type('Admin name', 'Jo');
    type('Admin email', 'jo@acme.com');
    click(/Generate/);
    await waitFor(() => expect((screen.getByLabelText('Admin password') as HTMLInputElement).value.length).toBeGreaterThanOrEqual(12));
    click('Next');
    await screen.findByText('Create Vendor');
  });
});
