import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { toast } from 'sonner';
import { customerAdjustmentsApi, type CustomerAdjustment } from '../api/customer-adjustments.api';
import { VOID_REASON_MIN_LENGTH, VoidAdjustmentDialog } from './void-adjustment-dialog';

jest.mock('../api/customer-adjustments.api', () => ({
  ...jest.requireActual('../api/customer-adjustments.api'),
  customerAdjustmentsApi: { list: jest.fn(), create: jest.fn(), void: jest.fn() },
}));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const voidApi = customerAdjustmentsApi.void as jest.Mock;

const adjustment = (o: Partial<CustomerAdjustment> = {}): CustomerAdjustment => ({
  id: 'adj-1',
  customerId: 'cust-1',
  kind: 'PENALTY',
  direction: 'CHARGE',
  amount: 500,
  effectiveDate: '2026-09-05T07:00:00.000Z',
  title: 'Late payment penalty',
  internalNote: null,
  referenceNo: null,
  customerVisibility: 'ITEMIZED',
  status: 'POSTED',
  voidedAt: null,
  voidReason: null,
  groupId: null,
  counterpartyCustomerId: null,
  createdAt: '2026-09-05T07:00:00.000Z',
  customer: { id: 'cust-1', name: 'Ahmed Khan', customerCode: 'C-0001' },
  createdBy: { id: 'u1', name: 'Bilal Accountant' },
  voidedBy: null,
  reversalOf: null,
  reversedBy: null,
  transaction: null,
  causedByStaffLedgerEntry: null,
  ...o,
});

const apiError = (status: number, message: string | string[]) =>
  Object.assign(new Error('request failed'), { response: { status, data: { message } } });

function setup(a: CustomerAdjustment = adjustment()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = jest.spyOn(client, 'invalidateQueries');
  const onOpenChange = jest.fn();
  const onVoided = jest.fn();
  const tree = (open: boolean) => (
    <QueryClientProvider client={client}>
      <VoidAdjustmentDialog adjustment={a} open={open} onOpenChange={onOpenChange} onVoided={onVoided} />
    </QueryClientProvider>
  );
  const utils = render(tree(true));
  return { ...utils, invalidate, onOpenChange, onVoided, reopen: () => { utils.rerender(tree(false)); utils.rerender(tree(true)); } };
}

const reasonField = () => screen.getByLabelText(/^Reason/) as HTMLTextAreaElement;
const submit = () => fireEvent.click(screen.getByRole('button', { name: /^void adjustment$/i }));
const enter = (reason: string) => fireEvent.change(reasonField(), { target: { value: reason } });

describe('VoidAdjustmentDialog', () => {
  beforeEach(() => {
    voidApi.mockReset();
    (toast.success as jest.Mock).mockReset();
    (toast.error as jest.Mock).mockReset();
  });

  it('explains exactly what a void does — a reversal, nothing deleted, not undoable', () => {
    setup();
    const text = screen.getByRole('dialog').textContent ?? '';
    expect(text).toMatch(/Penalty · Late payment penalty/);
    expect(text).toMatch(/\+ ₨ 500/);
    expect(text).toMatch(/posting a reversal/);
    expect(text).toMatch(/Nothing is deleted/);
    expect(text).toMatch(/cannot be undone/);
  });

  it('says which way the balance moves: voiding a charge lowers it, voiding a credit raises it', () => {
    const { unmount } = setup(adjustment({ direction: 'CHARGE' }));
    expect(screen.getByRole('dialog').textContent).toMatch(/lowers Ahmed Khan’s balance/);
    unmount();

    setup(adjustment({ kind: 'DISCOUNT', direction: 'CREDIT', amount: 250.5 }));
    const text = screen.getByRole('dialog').textContent ?? '';
    expect(text).toMatch(/raises Ahmed Khan’s balance/);
    expect(text).toMatch(/− ₨ 250\.5/);
  });

  describe('a reason is required', () => {
    it('refuses an empty or whitespace-only reason, shows why, and calls no API', () => {
      setup();
      expect(screen.queryByText(/reason of at least/i)).toBeNull(); // no nagging before an attempt
      submit();
      expect(screen.getByText(new RegExp(`at least ${VOID_REASON_MIN_LENGTH} characters is required`))).toBeTruthy();
      enter('      ');
      submit();
      expect(voidApi).not.toHaveBeenCalled();
    });

    it(`refuses fewer than ${VOID_REASON_MIN_LENGTH} characters (after trimming) and accepts exactly ${VOID_REASON_MIN_LENGTH}`, async () => {
      voidApi.mockResolvedValue({ data: { adjustment: { id: 'adj-1', status: 'VOIDED' }, reversal: { id: 'r1' }, customerBalance: 500 } });
      setup();
      enter('  abcd  ');
      submit();
      expect(voidApi).not.toHaveBeenCalled();

      enter('abcde');
      submit();
      await waitFor(() => expect(voidApi).toHaveBeenCalledTimes(1));
    });
  });

  describe('voiding', () => {
    beforeEach(() => {
      voidApi.mockResolvedValue({ data: { adjustment: { id: 'adj-1', status: 'VOIDED' }, reversal: { id: 'r1' }, customerBalance: 500 } });
    });

    it('calls the void endpoint for THIS adjustment with the trimmed reason, then closes and reports it', async () => {
      const { onOpenChange, onVoided } = setup(adjustment({ id: 'adj-42' }));
      enter('  Charged the wrong customer  ');
      submit();

      await waitFor(() => expect(onVoided).toHaveBeenCalledTimes(1));
      expect(voidApi).toHaveBeenCalledTimes(1);
      expect(voidApi).toHaveBeenCalledWith('adj-42', 'Charged the wrong customer');
      expect(onOpenChange).toHaveBeenCalledWith(false);
      expect((toast.success as jest.Mock).mock.calls[0][0]).toMatch(/voided/i);
    });

    it('refreshes the list, the customer balance, the ledger and the dashboards', async () => {
      const { invalidate, onVoided } = setup();
      enter('Entered in error');
      submit();
      await waitFor(() => expect(onVoided).toHaveBeenCalled());

      const keys = invalidate.mock.calls.map((c) => (c[0] as { queryKey: string[] }).queryKey[0]);
      expect(keys).toEqual(expect.arrayContaining(['customer-adjustments', 'customers', 'customer', 'transactions', 'analytics', 'dashboard']));
    });

    it('cannot be double-submitted while in flight (button or Enter)', async () => {
      voidApi.mockReturnValue(new Promise(() => undefined));
      setup();
      enter('Entered in error');
      submit();
      const button = await screen.findByRole('button', { name: /voiding…/i });
      expect((button as HTMLButtonElement).disabled).toBe(true);
      fireEvent.submit(button.closest('form') as HTMLFormElement);
      expect(voidApi).toHaveBeenCalledTimes(1);
    });

    it('Cancel closes without voiding', () => {
      const { onOpenChange, onVoided } = setup();
      enter('Entered in error');
      fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
      expect(onOpenChange).toHaveBeenCalledWith(false);
      expect(onVoided).not.toHaveBeenCalled();
      expect(voidApi).not.toHaveBeenCalled();
    });
  });

  describe('API errors stay in the dialog', () => {
    it.each([
      ['already voided (409)', apiError(409, 'This adjustment has already been voided.'), /already been voided/],
      ['no permission (403)', apiError(403, 'You do not have permission to void adjustments.'), /do not have permission/],
      ['a transfer leg (400)', apiError(400, 'This adjustment is one leg of a balance transfer and cannot be voided on its own.'), /one leg of a balance transfer/],
      ['a validation array', apiError(400, ['reason must be longer than or equal to 5 characters']), /reason must be longer/],
      ['a network failure', new Error('Network Error'), /Failed to void the adjustment/],
    ])('%s → shown inline and toasted; not closed, not reported, not refreshed', async (_label, error, expected) => {
      voidApi.mockRejectedValue(error);
      const { onOpenChange, onVoided, invalidate } = setup();
      enter('Entered in error');
      submit();

      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toMatch(expected);
      expect(reasonField().value).toBe('Entered in error'); // the reason is kept for a retry
      expect(onOpenChange).not.toHaveBeenCalled();
      expect(onVoided).not.toHaveBeenCalled();
      expect(invalidate).not.toHaveBeenCalled();
      expect(toast.error as jest.Mock).toHaveBeenCalledTimes(1);
    });

    it('lets the user retry after an error, and clears the error while retrying', async () => {
      voidApi.mockRejectedValueOnce(apiError(500, 'boom')).mockResolvedValue({ data: { adjustment: { id: 'adj-1', status: 'VOIDED' }, reversal: { id: 'r1' }, customerBalance: 0 } });
      const { onVoided } = setup();
      enter('Entered in error');
      submit();
      await screen.findByRole('alert');
      submit();
      await waitFor(() => expect(onVoided).toHaveBeenCalledTimes(1));
      expect(voidApi).toHaveBeenCalledTimes(2);
    });
  });

  it('starts clean each time it is opened (reason and error are cleared)', async () => {
    voidApi.mockRejectedValue(apiError(500, 'boom'));
    const { reopen } = setup();
    enter('Entered in error');
    submit();
    await screen.findByRole('alert');

    reopen();
    expect(reasonField().value).toBe('');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/reason of at least/i)).toBeNull();
  });
});
