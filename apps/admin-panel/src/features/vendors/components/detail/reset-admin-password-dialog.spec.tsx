import { screen, fireEvent, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { renderWithQuery } from '../../../../../test/utils/render';
import { ResetAdminPasswordDialog } from './reset-admin-password-dialog';
import { vendorDetailApi } from '../../api/vendor-detail.api';

jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
jest.mock('../../api/vendor-detail.api', () => ({ vendorDetailApi: { resetAdminPassword: jest.fn() } }));

const reset = vendorDetailApi.resetAdminPassword as jest.Mock;
const admin = { id: 'u1', email: 'admin@aqua.com', name: 'Ann' };
const PW = 'Str0ngPass99';
const SUPER = 'MySuperSecret1';

const fill = (labels: Record<string, string>) =>
  Object.entries(labels).forEach(([label, value]) => fireEvent.change(screen.getByLabelText(label), { target: { value } }));

const submitBtn = () => screen.getByRole('button', { name: /Reset password/ }) as HTMLButtonElement;

const fillValid = async () => {
  fill({ 'New password': PW, 'Confirm new password': PW, 'Your (super admin) password': SUPER });
  fireEvent.click(screen.getByRole('checkbox'));
  await waitFor(() => expect(submitBtn().disabled).toBe(false));
};

const renderDialog = (props: Partial<React.ComponentProps<typeof ResetAdminPasswordDialog>> = {}) =>
  renderWithQuery(<ResetAdminPasswordDialog vendorId="v1" vendorName="Aqua One" open admin={admin} onOpenChange={jest.fn()} {...props} />);

describe('ResetAdminPasswordDialog', () => {
  it('submit is disabled until everything is valid, and shows a mismatch error', async () => {
    renderDialog();
    expect(submitBtn().disabled).toBe(true);
    fill({ 'New password': PW, 'Confirm new password': 'Different123', 'Your (super admin) password': SUPER });
    fireEvent.click(screen.getByRole('checkbox'));
    await screen.findByText('Passwords do not match');
    expect(submitBtn().disabled).toBe(true);
    fill({ 'Confirm new password': PW });
    await waitFor(() => expect(submitBtn().disabled).toBe(false));
  });

  it('rejects a weak password', async () => {
    renderDialog();
    fill({ 'New password': 'short1' });
    await screen.findByText('Password must be at least 8 characters');
  });

  it('sends the exact body including the preselected adminUserId and reason', async () => {
    reset.mockResolvedValue({ message: 'ok', userId: 'u1', email: admin.email, sessionsRevoked: true });
    renderDialog();
    await fillValid();
    fill({ 'Reason (optional, kept in the audit log)': 'locked out' });
    fireEvent.click(submitBtn());
    await waitFor(() => expect(reset).toHaveBeenCalledTimes(1));
    expect(reset).toHaveBeenCalledWith('v1', { newPassword: PW, superAdminPassword: SUPER, adminUserId: 'u1', reason: 'locked out' });
  });

  it('success says sessions were revoked, empties the form and never toasts the password', async () => {
    reset.mockResolvedValue({ message: 'ok', userId: 'u1', email: admin.email, sessionsRevoked: true });
    const { container } = renderDialog();
    await fillValid();
    fireEvent.click(submitBtn());
    const status = await screen.findByRole('status');
    expect(status.textContent).toMatch(/sessions were revoked/i);
    const everything = JSON.stringify([(toast.success as jest.Mock).mock.calls, (toast.error as jest.Mock).mock.calls]);
    expect(everything).not.toContain(PW);
    expect(everything).not.toContain(SUPER);
    expect(document.body.textContent).not.toContain(PW);
    expect(document.body.textContent).not.toContain(SUPER);
    expect(container).toBeTruthy();
  });

  it('API error is shown via apiErrorMessage and the super-admin password is cleared', async () => {
    reset.mockRejectedValue({ response: { status: 403, data: { message: 'Incorrect password.' } } });
    renderDialog();
    await fillValid();
    fireEvent.click(submitBtn());
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Incorrect password.');
    expect((screen.getByLabelText('Your (super admin) password') as HTMLInputElement).value).toBe('');
    expect(document.body.textContent).not.toContain(PW);
  });

  it('shows an admin picker on a 409 with admins and then sends adminUserId', async () => {
    reset.mockRejectedValueOnce({
      response: { status: 409, data: { message: 'Several admins', admins: [{ id: 'a1', email: 'a1@x.com', name: 'One' }, { id: 'a2', email: 'a2@x.com', name: 'Two' }] } },
    });
    reset.mockResolvedValueOnce({ message: 'ok', userId: 'a2', email: 'a2@x.com', sessionsRevoked: true });
    renderDialog({ admin: null });
    await fillValid();
    fireEvent.click(submitBtn());
    const picker = (await screen.findByLabelText('Which admin?')) as HTMLSelectElement;
    expect(reset.mock.calls[0][1]).not.toHaveProperty('adminUserId');
    fill({ 'Your (super admin) password': SUPER });
    expect(submitBtn().disabled).toBe(true); // an admin must be chosen
    fireEvent.change(picker, { target: { value: 'a2' } });
    await waitFor(() => expect(submitBtn().disabled).toBe(false));
    fireEvent.click(submitBtn());
    await waitFor(() => expect(reset).toHaveBeenCalledTimes(2));
    expect(reset.mock.calls[1][1].adminUserId).toBe('a2');
  });

  it('clears every field when closed and reopened', async () => {
    const { rerender, client } = renderDialog();
    fill({ 'New password': PW, 'Your (super admin) password': SUPER });
    rerender(<ResetAdminPasswordDialog vendorId="v1" vendorName="Aqua One" open={false} admin={null} onOpenChange={jest.fn()} />);
    rerender(<ResetAdminPasswordDialog vendorId="v1" vendorName="Aqua One" open admin={admin} onOpenChange={jest.fn()} />);
    expect((await screen.findByLabelText('New password') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Your (super admin) password') as HTMLInputElement).value).toBe('');
    expect(client).toBeTruthy();
  });
});
