import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithQuery } from '../../../../test/utils/render';
import { billingApi, type Invoice, type Plan } from '../api/billing.api';
import { dateInputToIso, exceedsLimits, isOverdue, limitErrorMessage, limitText, remaining } from '../lib/billing';
import { PlanDialog, planFormSchema, toPlanInput } from './plan-dialog';
import { PlansTab } from './plans-tab';
import { InvoiceStatusBadge, RecordPaymentDialog, VoidInvoiceDialog } from './invoice-dialogs';
import { toAssignBody } from './assign-subscription-dialog';
import { UsageBars } from './usage-bars';

jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn(), warning: jest.fn() } }));
jest.mock('../api/billing.api', () => ({
  ...jest.requireActual('../api/billing.api'),
  billingApi: {
    plans: jest.fn(), createPlan: jest.fn(), updatePlan: jest.fn(), deletePlan: jest.fn(),
    invoice: jest.fn(), recordPayment: jest.fn(), voidInvoice: jest.fn(),
    vendorSubscription: jest.fn(), subscriptions: jest.fn(), assign: jest.fn(),
  },
}));
jest.mock('../../vendor-picker/vendor-picker', () => ({ useVendorSearch: () => ({ data: [], isLoading: false }) }));

const api = billingApi as unknown as Record<string, jest.Mock>;

const plan = (over: Partial<Plan> = {}): Plan => ({
  id: 'p1', name: 'Starter', description: null, price: '1000', currency: 'PKR', interval: 'MONTHLY', trialDays: 7,
  maxCustomers: 5, maxDrivers: 2, maxVans: null, isActive: true, sortOrder: 0, _count: { subscriptions: 0 }, ...over,
});
const invoice = (over: Partial<Invoice> = {}): Invoice => ({
  id: 'i1', number: 'INV-2026-000001', vendorId: 'v1', status: 'OPEN', description: null, amount: '1000', currency: 'PKR',
  issuedAt: '2026-01-01T00:00:00Z', dueAt: '2099-01-01T00:00:00Z', paidAt: null, voidReason: null, payments: [], ...over,
});

beforeEach(() => jest.clearAllMocks());

describe('billing lib', () => {
  it('null limit means Unlimited', () => {
    expect(limitText(null)).toBe('Unlimited');
    expect(limitText(0)).toBe('0');
  });
  it('overdue is derived from OPEN + past due date only', () => {
    expect(isOverdue({ status: 'OPEN', dueAt: '2020-01-01' })).toBe(true);
    expect(isOverdue({ status: 'PAID', dueAt: '2020-01-01' })).toBe(false);
    expect(isOverdue({ status: 'OPEN', dueAt: '2099-01-01' })).toBe(false);
  });
  it('remaining balance handles decimals', () => {
    expect(remaining({ amount: '0.3', payments: [{ amount: '0.1' }, { amount: '0.2' }] as Invoice['payments'] })).toBe(0);
  });
  it('detects usage over limits, ignoring unlimited', () => {
    const usage = { customers: 6, drivers: 1, vans: 99 };
    expect(exceedsLimits(usage, { maxCustomers: 5, maxDrivers: 2, maxVans: null })).toBe(true);
    expect(exceedsLimits(usage, { maxCustomers: null, maxDrivers: 2, maxVans: null })).toBe(false);
    expect(exceedsLimits(usage, null)).toBe(false);
  });
  it('maps PLAN_LIMIT_REACHED and SUBSCRIPTION_INACTIVE 403s to friendly text; others to null', () => {
    const limit = limitErrorMessage({ response: { status: 403, data: { code: 'PLAN_LIMIT_REACHED', resource: 'CUSTOMER', limit: 5, used: 5, planName: 'Starter' } } });
    expect(limit).toMatch(/Starter allows 5 customer/);
    expect(limitErrorMessage({ response: { status: 403, data: { code: 'SUBSCRIPTION_INACTIVE', status: 'PAST_DUE' } } })).toMatch(/past due/);
    expect(limitErrorMessage({ response: { status: 403, data: { message: 'nope' } } })).toBeNull();
    expect(limitErrorMessage({ response: { status: 500 } })).toBeNull();
  });
  it('date inputs become PKT noon', () => {
    expect(new Date(dateInputToIso('2026-03-01')).toISOString()).toBe('2026-03-01T07:00:00.000Z');
  });
  it('assign body only carries filled overrides and trial days when a trial starts', () => {
    const base = { vendorId: 'v', planId: 'p', startTrial: false, trialDays: '10', maxCustomers: '', maxDrivers: '3', maxVans: '', notes: '' };
    expect(toAssignBody(base)).toEqual({ planId: 'p', overrides: { maxDrivers: 3 } });
    expect(toAssignBody({ ...base, startTrial: true })).toEqual({ planId: 'p', startTrial: true, trialDays: 10, overrides: { maxDrivers: 3 } });
  });
});

describe('plan form schema', () => {
  const ok = { name: 'A', description: '', price: '10', interval: 'MONTHLY', trialDays: '', maxCustomers: '', maxDrivers: '', maxVans: '' };
  it('accepts blank limits as unlimited (null)', () => {
    expect(planFormSchema.safeParse(ok).success).toBe(true);
    expect(toPlanInput(ok as never)).toMatchObject({ maxCustomers: null, maxDrivers: null, maxVans: null, trialDays: 0, price: 10 });
  });
  it.each([
    ['negative price', { price: '-1' }],
    ['non numeric price', { price: 'abc' }],
    ['3 decimals', { price: '1.234' }],
    ['negative limit', { maxCustomers: '-3' }],
    ['fractional limit', { maxVans: '1.5' }],
    ['trial > 365', { trialDays: '400' }],
    ['empty name', { name: ' ' }],
  ])('rejects %s', (_n, patch) => {
    expect(planFormSchema.safeParse({ ...ok, ...patch }).success).toBe(false);
  });
});

describe('PlanDialog', () => {
  it('shows validation errors and does not call the API', async () => {
    renderWithQuery(<PlanDialog open plan={null} onClose={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Create plan' }));
    await screen.findByText('Name is required');
    expect(screen.getAllByRole('alert').length).toBeGreaterThanOrEqual(2);
    expect(api.createPlan).not.toHaveBeenCalled();
  });

  it('creates a plan with null limits for empty fields', async () => {
    api.createPlan.mockResolvedValue(plan());
    const onClose = jest.fn();
    renderWithQuery(<PlanDialog open plan={null} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Starter' } });
    fireEvent.change(screen.getByLabelText('Price (PKR)'), { target: { value: '1500' } });
    fireEvent.change(screen.getByLabelText('Max customers'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create plan' }));
    await waitFor(() => expect(api.createPlan).toHaveBeenCalled());
    expect(api.createPlan.mock.calls[0][0]).toMatchObject({ name: 'Starter', price: 1500, maxCustomers: 5, maxDrivers: null, maxVans: null });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});

describe('PlansTab', () => {
  it('renders Unlimited for null limits and toggles active state', async () => {
    api.plans.mockResolvedValue([plan()]);
    api.updatePlan.mockResolvedValue(plan({ isActive: false }));
    renderWithQuery(<PlansTab />);
    await screen.findByText('Starter');
    expect(screen.getByText('Unlimited')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Deactivate Starter'));
    await waitFor(() => expect(api.updatePlan).toHaveBeenCalledWith('p1', { isActive: false }));
  });

  it('shows the API error when delete is blocked by subscriptions', async () => {
    api.plans.mockResolvedValue([plan()]);
    api.deletePlan.mockRejectedValue({ response: { status: 409, data: { message: 'Plan is in use' } } });
    const { toast } = jest.requireMock('sonner');
    renderWithQuery(<PlansTab />);
    await screen.findByText('Starter');
    fireEvent.click(screen.getByLabelText('Delete Starter'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Plan is in use'));
  });
});

describe('UsageBars', () => {
  it('flags over-limit resources', () => {
    renderWithQuery(<UsageBars usage={{ customers: 7, drivers: 1, vans: 0 }} limits={{ maxCustomers: 5, maxDrivers: 2, maxVans: null }} />);
    expect(screen.getByTestId('usage-customers').getAttribute('data-over')).toBe('true');
    expect(screen.getByTestId('usage-drivers').getAttribute('data-over')).toBe('false');
    expect(screen.getByText('0 / Unlimited')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/Over the plan limits/);
  });
});

describe('invoices', () => {
  it('shows an Overdue badge for past-due OPEN invoices', () => {
    renderWithQuery(<InvoiceStatusBadge invoice={{ status: 'OPEN', dueAt: '2020-01-01T00:00:00Z' }} />);
    expect(screen.getByText('Overdue')).toBeTruthy();
  });

  it('payment dialog blocks overpayment against the remaining balance (counting earlier payments)', async () => {
    api.invoice.mockResolvedValue(invoice({ payments: [{ id: 'x', amount: '400', method: 'CASH', reference: null, paidOn: '2026-01-02', notes: null }] }));
    const inv = invoice();
    renderWithQuery(<RecordPaymentDialog invoice={inv} onClose={jest.fn()} />);
    await waitFor(() => expect(screen.getByTestId('payment-remaining').textContent).toMatch(/Remaining balance PKR 600/));
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '700' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }));
    await screen.findByText(/exceeds the remaining balance/);
    expect(api.recordPayment).not.toHaveBeenCalled();
  });

  it('records a valid partial payment with an InvoicePaymentMethod value', async () => {
    api.invoice.mockResolvedValue(invoice());
    api.recordPayment.mockResolvedValue({ invoice: invoice(), payment: {} });
    const inv = invoice();
    renderWithQuery(<RecordPaymentDialog invoice={inv} onClose={jest.fn()} />);
    await waitFor(() => expect((screen.getByRole('button', { name: 'Record payment' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '300' } });
    fireEvent.change(screen.getByLabelText('Method'), { target: { value: 'RAAST' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }));
    await waitFor(() => expect(api.recordPayment).toHaveBeenCalled());
    expect(api.recordPayment.mock.calls[0][0]).toBe('i1');
    expect(api.recordPayment.mock.calls[0][1]).toMatchObject({ amount: 300, method: 'RAAST' });
  });

  it('void requires a reason; a 409 (payments exist) is toasted', async () => {
    api.voidInvoice.mockRejectedValue({ response: { status: 409, data: { message: 'Invoice has payments' } } });
    const { toast } = jest.requireMock('sonner');
    renderWithQuery(<VoidInvoiceDialog invoice={invoice()} onClose={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Void invoice' }));
    await screen.findByText('A reason is required');
    expect(api.voidInvoice).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'duplicate' } });
    fireEvent.click(screen.getByRole('button', { name: 'Void invoice' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Invoice has payments'));
  });
});
