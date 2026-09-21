import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { PostableAdjustmentKind } from '../api/customer-adjustments.api';
import { customerAdjustmentsApi } from '../api/customer-adjustments.api';
import { addDaysYmd, pktToday, startOfMonthYmd } from '../../../lib/date-pkt';
import { CreateAdjustmentDialog } from './create-adjustment-dialog';

jest.mock('../api/customer-adjustments.api', () => ({
  ...jest.requireActual('../api/customer-adjustments.api'),
  customerAdjustmentsApi: { list: jest.fn(), create: jest.fn(), void: jest.fn() },
}));
// The real hooks module pulls in nuqs (ESM, not transformable here) — stub just `useCustomer`,
// which the dialog reads only for the current balance and the customer's name.
let mockCustomer: { name: string; financialBalance: number } | undefined;
jest.mock('../../customers/hooks/use-customers', () => ({ useCustomer: () => ({ data: mockCustomer }) }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const create = customerAdjustmentsApi.create as jest.Mock;
const CUSTOMER_ID = 'cust-1';
const ALL_KINDS: PostableAdjustmentKind[] = [
  'SERVICE_FEE', 'PENALTY', 'OTHER_CHARGE', 'DISCOUNT', 'GOODWILL_CREDIT', 'OTHER_CREDIT', 'WRITE_OFF', 'CORRECTION',
];
const CHARGES = ALL_KINDS.slice(0, 3);

const created = (kind = 'PENALTY', amount = 500) => ({
  data: {
    adjustment: { id: 'a1', kind, direction: 'CHARGE', amount, title: 'x' },
    transaction: { id: 't1', amount },
    customerBalance: 1500,
    idempotentReplay: false,
  },
});
const apiError = (status: number, message: string | string[]) =>
  Object.assign(new Error('request failed'), { response: { status, data: { message } } });

function setup(props: { kinds?: PostableAdjustmentKind[]; open?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = jest.spyOn(client, 'invalidateQueries');
  const onOpenChange = jest.fn();
  const tree = (open: boolean) => (
    <QueryClientProvider client={client}>
      <CreateAdjustmentDialog customerId={CUSTOMER_ID} kinds={props.kinds ?? ALL_KINDS} open={open} onOpenChange={onOpenChange} />
    </QueryClientProvider>
  );
  const utils = render(tree(props.open ?? true));
  return { ...utils, client, invalidate, onOpenChange, reopen: () => { utils.rerender(tree(false)); utils.rerender(tree(true)); } };
}

const field = (label: RegExp) => screen.getByLabelText(label) as HTMLInputElement;
const type = (label: RegExp, value: string) => fireEvent.change(field(label), { target: { value } });
const chooseKind = (kind: string) => fireEvent.change(field(/^Type/), { target: { value: kind } });
const post = () => fireEvent.click(screen.getByRole('button', { name: /post adjustment/i }));
const keyOf = (call: number) => create.mock.calls[call][0].idempotencyKey as string;

/** A valid charge, ready to post. */
function fillPenalty() {
  chooseKind('PENALTY');
  type(/^Amount/, '500');
  type(/^Title/, 'Late payment penalty');
}

describe('CreateAdjustmentDialog', () => {
  beforeEach(() => {
    create.mockReset();
    (toast.success as jest.Mock).mockReset();
    (toast.error as jest.Mock).mockReset();
    mockCustomer = { name: 'Ahmed Khan', financialBalance: 1000 };
  });

  describe('kind selection follows the permissions it was given', () => {
    it('offers only the kinds passed in (charges only)', () => {
      setup({ kinds: CHARGES });
      const options = within(field(/^Type/)).getAllByRole('option').map((o) => o.textContent);
      expect(options).toEqual(['Service fee', 'Penalty', 'Other charge']);
    });

    it('groups the full set into Charges / Credits / Restricted', () => {
      const { baseElement } = setup();
      const groups = [...baseElement.querySelectorAll('optgroup')].map((g) => ({
        label: g.getAttribute('label'),
        kinds: [...g.querySelectorAll('option')].map((o) => o.textContent),
      }));
      expect(groups).toEqual([
        { label: 'Charges', kinds: ['Service fee', 'Penalty', 'Other charge'] },
        { label: 'Credits', kinds: ['Discount', 'Goodwill credit', 'Other credit'] },
        { label: 'Restricted', kinds: ['Write-off', 'Correction'] },
      ]);
    });

    it('a credit-only user is offered just the credit kinds, with no empty group', () => {
      const { baseElement } = setup({ kinds: ['DISCOUNT', 'GOODWILL_CREDIT', 'OTHER_CREDIT'] });
      expect([...baseElement.querySelectorAll('optgroup')].map((g) => g.getAttribute('label'))).toEqual(['Credits']);
    });

    it('starts on the first offered kind', () => {
      setup({ kinds: ['DISCOUNT', 'OTHER_CREDIT'] });
      expect(field(/^Type/).value).toBe('DISCOUNT');
    });
  });

  describe('the direction is controlled by the backend, not the form', () => {
    it.each([
      ['SERVICE_FEE', /Charge — raises what the customer owes/],
      ['PENALTY', /Charge — raises/],
      ['DISCOUNT', /Credit — lowers what the customer owes/],
      ['GOODWILL_CREDIT', /Credit — lowers/],
      ['WRITE_OFF', /Credit — lowers/],
    ])('%s shows a fixed effect and offers no direction choice', (kind, effect) => {
      setup();
      chooseKind(kind);
      expect(screen.getByTestId('adj-effect').textContent).toMatch(effect);
      expect(screen.queryByLabelText(/Effect on balance/)).toBeNull();
    });

    it('CORRECTION alone asks the user to choose — and starts undecided', () => {
      setup();
      chooseKind('CORRECTION');
      expect(screen.queryByTestId('adj-effect')).toBeNull();
      const direction = field(/Effect on balance/);
      expect(direction.value).toBe('');
      expect(within(direction).getAllByRole('option').map((o) => o.textContent)).toEqual([
        'Choose…',
        'Charge — raises what the customer owes',
        'Credit — lowers what the customer owes',
      ]);
    });

    it('never sends a direction for a fixed kind (the backend decides)', async () => {
      create.mockResolvedValue(created());
      setup();
      fillPenalty();
      post();
      await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
      expect('direction' in create.mock.calls[0][0]).toBe(false);
    });

    it('sends the direction for CORRECTION, and refuses to post without one', async () => {
      create.mockResolvedValue(created('CORRECTION'));
      setup();
      chooseKind('CORRECTION');
      type(/^Amount/, '75');
      type(/^Title/, 'Meter fix');
      type(/^Internal note/, 'Booked twice');
      post();
      expect(screen.getByText(/Say whether this raises or lowers/)).toBeTruthy();
      expect(create).not.toHaveBeenCalled();

      fireEvent.change(field(/Effect on balance/), { target: { value: 'CREDIT' } });
      post();
      await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
      expect(create.mock.calls[0][0]).toMatchObject({ kind: 'CORRECTION', direction: 'CREDIT', amount: 75 });
    });

    it('changing the kind clears a previously chosen correction direction', () => {
      setup();
      chooseKind('CORRECTION');
      fireEvent.change(field(/Effect on balance/), { target: { value: 'CHARGE' } });
      chooseKind('PENALTY');
      chooseKind('CORRECTION');
      expect(field(/Effect on balance/).value).toBe('');
    });
  });

  describe('field rules', () => {
    it('marks the internal note required only where the policy requires it, and says who sees the title', () => {
      setup();
      chooseKind('PENALTY');
      expect(screen.getByLabelText(/^Internal note/).closest('div')?.textContent).not.toMatch(/\*/);
      expect(screen.getByText(/Shown to the customer on their statement/)).toBeTruthy();

      chooseKind('DISCOUNT');
      expect(screen.getByText(/^Internal note/).textContent).toMatch(/\*/);

      chooseKind('WRITE_OFF');
      expect(screen.getByText(/Staff-only. The customer sees “Account adjustment”/)).toBeTruthy();
    });

    it('limits the date to this month up to today', () => {
      setup();
      const date = field(/^Date/);
      expect(date.min).toBe(startOfMonthYmd(pktToday()));
      expect(date.max).toBe(pktToday());
      expect(date.value).toBe(pktToday()); // defaults to today
    });
  });

  describe('validation (nothing is posted until the form is valid)', () => {
    it('shows every problem on the first attempt and calls no API', () => {
      setup();
      chooseKind('DISCOUNT');
      post();
      expect(screen.getByText('Enter an amount.')).toBeTruthy();
      expect(screen.getByText('Enter a title.')).toBeTruthy();
      expect(screen.getByText(/An internal note is required/)).toBeTruthy();
      expect(create).not.toHaveBeenCalled();
    });

    it('shows no errors before the first attempt', () => {
      setup();
      expect(screen.queryByText('Enter an amount.')).toBeNull();
      expect(screen.queryByText('Enter a title.')).toBeNull();
    });

    it('clears an error as soon as it is fixed', () => {
      setup();
      post();
      expect(screen.getByText('Enter an amount.')).toBeTruthy();
      type(/^Amount/, '100');
      expect(screen.queryByText('Enter an amount.')).toBeNull();
    });

    it.each([['0'], ['-5'], ['12.345']])('rejects the amount %p', (amount) => {
      setup();
      fillPenalty();
      type(/^Amount/, amount);
      post();
      expect(screen.getByText(/Amount must be more than 0 with at most 2 decimal places/)).toBeTruthy();
      expect(create).not.toHaveBeenCalled();
    });

    it('rejects a date in the previous month and one in the future', () => {
      setup();
      fillPenalty();
      type(/^Date/, addDaysYmd(startOfMonthYmd(pktToday()), -1));
      post();
      expect(screen.getByText(/within the current month/)).toBeTruthy();

      type(/^Date/, addDaysYmd(pktToday(), 1));
      expect(screen.getByText(/cannot be in the future/)).toBeTruthy();
      expect(create).not.toHaveBeenCalled();
    });
  });

  describe('posting', () => {
    it('sends exactly the entered values, once, and closes on success', async () => {
      create.mockResolvedValue(created());
      const { onOpenChange } = setup();
      fillPenalty();
      type(/^Reference/, ' INV-9 ');
      post();

      await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
      expect(create).toHaveBeenCalledTimes(1);
      expect(create.mock.calls[0][0]).toEqual({
        customerId: CUSTOMER_ID,
        kind: 'PENALTY',
        amount: 500,
        title: 'Late payment penalty',
        internalNote: undefined,
        referenceNo: 'INV-9',
        effectiveDate: undefined, // today → the backend stamps the real posting moment
        idempotencyKey: expect.any(String),
      });
      expect(keyOf(0).length).toBeGreaterThanOrEqual(8);
      expect((toast.success as jest.Mock).mock.calls[0][0]).toMatch(/Penalty of ₨ 500 posted/);
    });

    it('sends an earlier day this month as the effective date', async () => {
      create.mockResolvedValue(created());
      setup();
      fillPenalty();
      const earlier = startOfMonthYmd(pktToday());
      type(/^Date/, earlier);
      post();
      await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
      // (on the 1st of the month "earlier" is today, which is correctly omitted)
      expect(create.mock.calls[0][0].effectiveDate).toBe(earlier === pktToday() ? undefined : earlier);
    });

    it('refreshes the list, the customer balance, the ledger and the dashboards after success', async () => {
      create.mockResolvedValue(created());
      const { invalidate, onOpenChange } = setup();
      fillPenalty();
      post();
      await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));

      const keys = invalidate.mock.calls.map((c) => (c[0] as { queryKey: string[] }).queryKey[0]);
      expect(keys).toEqual(expect.arrayContaining(['customer-adjustments', 'customers', 'customer', 'transactions', 'analytics', 'dashboard']));
    });

    it('does NOT refresh or close on failure', async () => {
      create.mockRejectedValue(apiError(400, 'nope'));
      const { invalidate, onOpenChange } = setup();
      fillPenalty();
      post();
      await screen.findByRole('alert');
      expect(onOpenChange).not.toHaveBeenCalled();
      expect(invalidate.mock.calls.filter((c) => (c[0] as { queryKey: string[] }).queryKey[0] === 'customer-adjustments')).toHaveLength(0);
    });

    it('cannot be double-submitted while the request is in flight (button or Enter)', async () => {
      create.mockReturnValue(new Promise(() => undefined)); // never settles
      setup();
      fillPenalty();
      post();
      const button = await screen.findByRole('button', { name: /posting…/i });
      expect((button as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(button);
      fireEvent.submit(button.closest('form') as HTMLFormElement); // Enter in a field
      expect(create).toHaveBeenCalledTimes(1);
    });

    it('Cancel closes without posting', () => {
      const { onOpenChange } = setup();
      fillPenalty();
      fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
      expect(onOpenChange).toHaveBeenCalledWith(false);
      expect(create).not.toHaveBeenCalled();
    });
  });

  describe('API errors stay in the dialog with the form intact', () => {
    it('shows a business-rule message (string) inline and toasts it', async () => {
      create.mockRejectedValue(apiError(400, 'Effective date must be within the current month.'));
      const { onOpenChange } = setup();
      fillPenalty();
      post();

      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toBe('Effective date must be within the current month.');
      expect(onOpenChange).not.toHaveBeenCalled();
      expect(field(/^Amount/).value).toBe('500'); // nothing lost
      expect(field(/^Title/).value).toBe('Late payment penalty');
      expect((toast.error as jest.Mock).mock.calls[0][0]).toBe('Effective date must be within the current month.');
    });

    it('joins a validation-pipe message ARRAY into readable text', async () => {
      create.mockRejectedValue(apiError(400, ['title must be shorter than or equal to 120 characters', 'amount must not be less than 0.01']));
      setup();
      fillPenalty();
      post();
      expect((await screen.findByRole('alert')).textContent).toBe(
        'title must be shorter than or equal to 120 characters amount must not be less than 0.01',
      );
    });

    it('falls back to a generic message when the server sends none (network error)', async () => {
      create.mockRejectedValue(new Error('Network Error'));
      setup();
      fillPenalty();
      post();
      expect((await screen.findByRole('alert')).textContent).toMatch(/Failed to post the adjustment/);
    });

    it('surfaces the write-off cap and permission refusals from the server', async () => {
      create.mockRejectedValue(apiError(403, 'You do not have permission to post this type of adjustment.'));
      setup();
      fillPenalty();
      post();
      expect((await screen.findByRole('alert')).textContent).toMatch(/do not have permission/);
    });

    it('a retry after an error re-uses the SAME idempotency key (safe if the first request actually landed)', async () => {
      create.mockRejectedValueOnce(apiError(500, 'boom')).mockResolvedValue(created());
      const { onOpenChange } = setup();
      fillPenalty();
      post();
      await screen.findByRole('alert');
      post();
      await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
      expect(create).toHaveBeenCalledTimes(2);
      expect(keyOf(1)).toBe(keyOf(0));
    });

    it('the error clears when the user retries', async () => {
      create.mockRejectedValueOnce(apiError(400, 'first failure')).mockReturnValue(new Promise(() => undefined));
      setup();
      fillPenalty();
      post();
      await screen.findByRole('alert');
      post();
      await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    });

    it('mints a NEW key after the server says the key was used for a different request', async () => {
      create
        .mockRejectedValueOnce(apiError(409, 'This idempotency key was already used for a different adjustment. Use a new key.'))
        .mockResolvedValue(created());
      setup();
      fillPenalty();
      post();
      await screen.findByRole('alert');
      type(/^Amount/, '600'); // the user changes the request
      post();
      await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
      expect(keyOf(1)).not.toBe(keyOf(0));
    });

    it('does NOT mint a new key for any other 409', async () => {
      create.mockRejectedValueOnce(apiError(409, 'Something else conflicted.')).mockResolvedValue(created());
      setup();
      fillPenalty();
      post();
      await screen.findByRole('alert');
      post();
      await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
      expect(keyOf(1)).toBe(keyOf(0));
    });
  });

  describe('each opening starts clean', () => {
    it('resets the form, the errors and the idempotency key when re-opened', async () => {
      create.mockRejectedValue(apiError(400, 'first failure'));
      const { reopen } = setup();
      fillPenalty();
      type(/^Internal note/, 'some note');
      post();
      await screen.findByRole('alert');
      const firstKey = keyOf(0);

      reopen();
      expect(field(/^Title/).value).toBe('');
      expect(field(/^Amount/).value).toBe('');
      expect(field(/^Internal note/).value).toBe('');
      expect(screen.queryByRole('alert')).toBeNull();
      expect(screen.queryByText('Enter an amount.')).toBeNull();

      fillPenalty();
      post();
      await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
      expect(keyOf(1)).not.toBe(firstKey); // a new submit is a new posting
    });
  });

  describe('balance-after estimate (simple arithmetic on the loaded balance — no preview API)', () => {
    it('a charge shows the balance rising', async () => {
      setup();
      chooseKind('PENALTY');
      type(/^Amount/, '250');
      const preview = await screen.findByTestId('adj-balance-preview');
      expect(preview.textContent).toMatch(/Now ₨ 1,000 owed/);
      expect(preview.textContent).toMatch(/₨ 1,250 owed/);
    });

    it('a credit shows it falling, and going into credit when it exceeds the balance', async () => {
      setup();
      chooseKind('DISCOUNT');
      type(/^Amount/, '250.5');
      expect((await screen.findByTestId('adj-balance-preview')).textContent).toMatch(/₨ 749.5 owed/);

      type(/^Amount/, '1500');
      await waitFor(() => expect(screen.getByTestId('adj-balance-preview').textContent).toMatch(/₨ 500 credit/));
    });

    it('for a CORRECTION it waits for the direction, then follows it', async () => {
      setup();
      chooseKind('CORRECTION');
      type(/^Amount/, '100');
      await screen.findByLabelText(/Effect on balance/);
      expect(screen.queryByTestId('adj-balance-preview')).toBeNull();

      fireEvent.change(field(/Effect on balance/), { target: { value: 'CREDIT' } });
      expect((await screen.findByTestId('adj-balance-preview')).textContent).toMatch(/₨ 900 owed/);
      fireEvent.change(field(/Effect on balance/), { target: { value: 'CHARGE' } });
      await waitFor(() => expect(screen.getByTestId('adj-balance-preview').textContent).toMatch(/₨ 1,100 owed/));
    });

    it('is hidden until the amount is valid', async () => {
      setup();
      chooseKind('PENALTY');
      expect(screen.queryByTestId('adj-balance-preview')).toBeNull();
      type(/^Amount/, '12.345');
      expect(screen.queryByTestId('adj-balance-preview')).toBeNull();
    });

    it('warns when a write-off exceeds what is owed (the backend enforces it), and not otherwise', async () => {
      setup();
      chooseKind('WRITE_OFF');
      type(/^Amount/, '1000');
      await screen.findByTestId('adj-balance-preview');
      expect(screen.queryByText(/cannot exceed what the customer owes/)).toBeNull();

      type(/^Amount/, '1000.01');
      expect((await screen.findByText(/cannot exceed what the customer owes/)).textContent).toMatch(/₨ 1,000/);

      chooseKind('DISCOUNT'); // the cap is a write-off rule only
      expect(screen.queryByText(/cannot exceed what the customer owes/)).toBeNull();
    });

    it('shows no estimate if the balance could not be loaded (the form still works)', async () => {
      mockCustomer = undefined; // the balance never loaded
      create.mockResolvedValue(created());
      setup();
      fillPenalty();
      expect(screen.queryByTestId('adj-balance-preview')).toBeNull();
      post();
      await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    });
  });
});
