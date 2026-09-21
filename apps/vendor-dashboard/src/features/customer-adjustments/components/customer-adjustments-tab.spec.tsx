import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CustomerAdjustmentsTab } from './customer-adjustments-tab';
import { toast } from 'sonner';
import { customerAdjustmentsApi, type CustomerAdjustment, type CustomerAdjustmentPage } from '../api/customer-adjustments.api';

jest.mock('../api/customer-adjustments.api', () => ({
  ...jest.requireActual('../api/customer-adjustments.api'),
  customerAdjustmentsApi: { list: jest.fn(), create: jest.fn(), void: jest.fn() },
}));
// What the signed-in user may do — set per test via grant().
const mockGranted = new Set<string>();
jest.mock('../../authz/hooks/use-permissions', () => ({
  usePermissions: () => ({ can: (permission: string) => mockGranted.has(permission) }),
}));
// The real hooks module pulls in nuqs (ESM, not transformable here); the create dialog only reads
// the customer's balance and name from it.
jest.mock('../../customers/hooks/use-customers', () => ({
  useCustomer: () => ({ data: { name: 'Ahmed Khan', financialBalance: 1000 } }),
}));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const list = customerAdjustmentsApi.list as jest.Mock;
const createApi = customerAdjustmentsApi.create as jest.Mock;
const voidApi = customerAdjustmentsApi.void as jest.Mock;
const grant = (...actions: string[]) =>
  actions.forEach((a) => mockGranted.add(a.includes(':') ? a : 'customer_financial_adjustments:' + a));
const CUSTOMER_ID = 'cust-1';
const CUSTOMER = { id: CUSTOMER_ID, name: 'Ahmed Khan', customerCode: 'C-0001' };
const STAFF = { id: 'u1', name: 'Bilal Accountant' };

/** A fully-populated row; each fixture overrides only what makes it different. */
const row = (o: Partial<CustomerAdjustment> & { id: string }): CustomerAdjustment => ({
  customerId: CUSTOMER_ID,
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
  customer: CUSTOMER,
  createdBy: STAFF,
  voidedBy: null,
  reversalOf: null,
  reversedBy: null,
  transaction: { id: 't1', amount: 500, description: 'Late payment penalty', createdAt: '2026-09-05T07:00:00.000Z' },
  ...o,
});

const page = (data: CustomerAdjustment[], total = data.length): { data: CustomerAdjustmentPage } => ({
  data: { data, meta: { total, page: 1, limit: 10, totalPages: Math.max(1, Math.ceil(total / 10)) } },
});

const ROWS: CustomerAdjustment[] = [
  row({ id: 'a-penalty', kind: 'PENALTY', title: 'Late payment penalty', amount: 500, referenceNo: 'INV-77', internalNote: 'Third reminder ignored' }),
  row({
    id: 'a-discount',
    kind: 'DISCOUNT',
    direction: 'CREDIT',
    amount: 250.5,
    title: 'Loyalty discount',
    transaction: { id: 't2', amount: -250.5, description: 'Loyalty discount', createdAt: '2026-09-04T07:00:00.000Z' },
  }),
  row({
    id: 'a-writeoff',
    kind: 'WRITE_OFF',
    direction: 'CREDIT',
    amount: 1200,
    title: 'Bad debt — closed shop',
    customerVisibility: 'SUMMARIZED',
    internalNote: 'Owner confirmed shop closed',
    transaction: { id: 't3', amount: -1200, description: 'Account adjustment', createdAt: '2026-09-03T07:00:00.000Z' },
  }),
  row({
    id: 'a-voided',
    kind: 'SERVICE_FEE',
    title: 'Installation fee',
    amount: 300,
    status: 'VOIDED',
    voidedAt: '2026-09-06T08:00:00.000Z',
    voidedBy: STAFF,
    voidReason: 'Charged the wrong customer',
    reversedBy: { id: 'a-reversal', kind: 'REVERSAL', status: 'POSTED', effectiveDate: '2026-09-06T08:00:00.000Z' },
  }),
  row({
    id: 'a-reversal',
    kind: 'REVERSAL',
    direction: 'CREDIT',
    amount: 300,
    title: 'Reversal: Installation fee',
    reversalOf: { id: 'a-voided', kind: 'SERVICE_FEE', title: 'Installation fee', status: 'VOIDED', effectiveDate: '2026-09-05T07:00:00.000Z' },
    transaction: { id: 't5', amount: -300, description: 'Reversal: Installation fee', createdAt: '2026-09-06T08:00:00.000Z' },
  }),
  row({
    id: 'a-transfer',
    kind: 'TRANSFER_OUT',
    direction: 'CREDIT',
    amount: 700,
    title: 'Balance transferred to C-0002',
    groupId: 'grp-1',
    counterpartyCustomerId: 'cust-2',
    transaction: { id: 't6', amount: -700, description: 'Balance transferred to C-0002', createdAt: '2026-09-02T07:00:00.000Z' },
  }),
];

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <CustomerAdjustmentsTab customerId={CUSTOMER_ID} />
    </QueryClientProvider>,
  );
}

const lastParams = () => list.mock.calls[list.mock.calls.length - 1][0];

describe('CustomerAdjustmentsTab', () => {
  beforeEach(() => {
    list.mockReset();
    createApi.mockReset();
    voidApi.mockReset();
    (toast.success as jest.Mock).mockReset();
    (toast.error as jest.Mock).mockReset();
    mockGranted.clear();
  });

  describe('empty state', () => {
    it('shows the empty message — no table, no rows — and asks only for THIS customer, first page', async () => {
      list.mockResolvedValue(page([]));
      renderTab();

      expect(await screen.findByText('No charges or credits on this account yet.')).toBeTruthy();
      expect(screen.queryByRole('table')).toBeNull();
      expect(screen.queryByText(/match your filters/i)).toBeNull();
      expect(screen.queryByRole('button', { name: /clear filters/i })).toBeNull();
      expect(list).toHaveBeenCalledTimes(1);
      expect(lastParams()).toEqual({
        customerId: CUSTOMER_ID,
        page: 1,
        limit: 10,
        kind: undefined,
        status: undefined,
        dateFrom: undefined,
        dateTo: undefined,
      });
    });
  });

  describe('populated state', () => {
    beforeEach(() => list.mockResolvedValue(page(ROWS)));

    it('lists every adjustment with its type, description, signed amount, status and author', async () => {
      renderTab();
      expect(await screen.findByText('Late payment penalty')).toBeTruthy();

      const table = screen.getByRole('table');
      ['Date', 'Type', 'Description', 'Amount', 'Status', 'Posted by'].forEach((h) =>
        expect(within(table).getByRole('columnheader', { name: h })).toBeTruthy(),
      );
      // one body row per adjustment (+ the header row)
      expect(within(table).getAllByRole('row')).toHaveLength(ROWS.length + 1);

      // type labels come from the shared kind policy
      ['Penalty', 'Discount', 'Write-off', 'Service fee', 'Reversal', 'Transfer out'].forEach((label) =>
        expect(within(table).getAllByText(label).length).toBeGreaterThan(0),
      );

      // charge = "+" (owes more), credit = "−" (owes less); decimals kept, thousands grouped
      expect(within(table).getByText('+ ₨ 500')).toBeTruthy();
      expect(within(table).getByText('− ₨ 250.5')).toBeTruthy();
      expect(within(table).getByText('− ₨ 1,200')).toBeTruthy();
      expect(within(table).getByText('Ref INV-77')).toBeTruthy();
      expect(within(table).getAllByText('Bilal Accountant').length).toBe(ROWS.length);

      // status badges: a voided row is marked as such
      expect(within(table).getAllByText('Posted')).toHaveLength(ROWS.length - 1);
      expect(within(table).getAllByText('Voided')).toHaveLength(1);
    });

    it('marks a voided row visually (struck-through title and amount)', async () => {
      renderTab();
      const voidedTitle = await screen.findByText('Installation fee');
      expect(voidedTitle.classList.contains('line-through')).toBe(true);
      expect(within(screen.getByRole('table')).getByText('+ ₨ 300').classList.contains('line-through')).toBe(true);
      expect(screen.getByText('Late payment penalty').classList.contains('line-through')).toBe(false);
    });

    it('is READ-ONLY: no create / void / transfer / edit controls anywhere on the tab', async () => {
      renderTab();
      await screen.findByText('Late payment penalty');
      expect(screen.queryByRole('button', { name: /add|create|new|post|void|transfer|edit|delete|reverse/i })).toBeNull();
    });
  });

  describe('filters', () => {
    it('sends the chosen type / status / date range to the API and goes back to page 1', async () => {
      list.mockResolvedValue(page(ROWS));
      renderTab();
      await screen.findByText('Late payment penalty');

      fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'PENALTY' } });
      await waitFor(() => expect(lastParams()).toMatchObject({ kind: 'PENALTY', page: 1 }));

      fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'VOIDED' } });
      await waitFor(() => expect(lastParams()).toMatchObject({ kind: 'PENALTY', status: 'VOIDED' }));

      fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-09-01' } });
      fireEvent.change(screen.getByLabelText('To date'), { target: { value: '2026-09-30' } });
      await waitFor(() =>
        expect(lastParams()).toEqual({
          customerId: CUSTOMER_ID,
          page: 1,
          limit: 10,
          kind: 'PENALTY',
          status: 'VOIDED',
          dateFrom: '2026-09-01',
          dateTo: '2026-09-30',
        }),
      );
    });

    it('pages through results, and a filter change from page 2 returns to page 1', async () => {
      list.mockResolvedValue(page(ROWS, 25)); // 25 rows at 10 per page → 3 pages
      const { container } = renderTab();
      await screen.findByText('Late payment penalty');
      expect(lastParams().page).toBe(1);

      // the pagination buttons are icon-only; find "next" by its chevron
      const next = container.querySelector('.lucide-chevron-right')?.closest('button') as HTMLButtonElement;
      fireEvent.click(next);
      await waitFor(() => expect(lastParams().page).toBe(2));

      fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'POSTED' } });
      await waitFor(() => expect(lastParams()).toMatchObject({ status: 'POSTED', page: 1 }));
    });

    it('offers every adjustment kind (incl. reversals and transfer legs) and both statuses', async () => {
      list.mockResolvedValue(page(ROWS));
      renderTab();
      await screen.findByText('Late payment penalty');

      const kinds = within(screen.getByLabelText('Type')).getAllByRole('option').map((o) => o.textContent);
      expect(kinds).toEqual([
        'All types',
        'Service fee',
        'Penalty',
        'Other charge',
        'Discount',
        'Goodwill credit',
        'Other credit',
        'Transfer out',
        'Transfer in',
        'Write-off',
        'Correction',
        'Reversal',
      ]);
      expect(within(screen.getByLabelText('Status')).getAllByRole('option').map((o) => o.textContent)).toEqual([
        'All statuses',
        'Posted',
        'Voided',
      ]);
    });

    it('shows a "no match" state (not the empty-account one) when filters exclude everything, and Clear filters restores the list', async () => {
      list.mockImplementation(async (p) => (p.kind ? page([]) : page(ROWS)));
      renderTab();
      await screen.findByText('Late payment penalty');

      fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'CORRECTION' } });
      expect(await screen.findByText('No charges or credits match your filters.')).toBeTruthy();
      expect(screen.queryByText('No charges or credits on this account yet.')).toBeNull();

      // both the filter-bar button and the empty-state link clear it; use the bar's
      fireEvent.click(screen.getAllByRole('button', { name: /clear filters/i })[0]);
      expect(await screen.findByText('Late payment penalty')).toBeTruthy();
      expect(lastParams().kind).toBeUndefined();
      expect(screen.queryByRole('button', { name: /clear filters/i })).toBeNull();
    });
  });

  describe('detail view', () => {
    const open = async (title: string) => {
      list.mockResolvedValue(page(ROWS));
      renderTab();
      fireEvent.click(await screen.findByText(title));
      return screen.findByRole('dialog');
    };

    it('opens a charge with its amount, dates, reference, ledger wording and staff note — and no action buttons', async () => {
      const dialog = await open('Late payment penalty');

      expect(within(dialog).getByRole('heading', { name: /Penalty/ })).toBeTruthy();
      expect(within(dialog).getByText('+ ₨ 500')).toBeTruthy();
      expect(within(dialog).getByText(/Increased what Ahmed Khan owes/)).toBeTruthy();
      expect(within(dialog).getByText('(C-0001)')).toBeTruthy(); // the Customer row (name + code)
      expect(within(dialog).getByText('INV-77')).toBeTruthy();
      expect(within(dialog).getByText('Statement / portal line')).toBeTruthy();
      expect(within(dialog).getByText('Itemised')).toBeTruthy();
      expect(within(dialog).getByText('Internal note (staff only)')).toBeTruthy();
      expect(within(dialog).getByText('Third reminder ignored')).toBeTruthy();
      // read-only: the only button is the dialog's own close control
      const buttons = within(dialog).getAllByRole('button');
      expect(buttons).toHaveLength(1);
      expect(buttons[0].textContent).toMatch(/close/i);
    });

    it('a credit reads as reducing the balance', async () => {
      const dialog = await open('Loyalty discount');
      expect(within(dialog).getByText('− ₨ 250.5')).toBeTruthy();
      expect(within(dialog).getByText(/Reduced what Ahmed Khan owes/)).toBeTruthy();
      expect(within(dialog).queryByText('Internal note (staff only)')).toBeNull(); // none recorded
    });

    it('a SUMMARIZED write-off shows the neutral wording the customer sees, and keeps the title/note staff-only', async () => {
      const dialog = await open('Bad debt — closed shop');
      expect(within(dialog).getByText('Account adjustment')).toBeTruthy(); // the ledger line
      expect(within(dialog).getByText('Summarised')).toBeTruthy();
      expect(within(dialog).getByText(/title and note above are staff-only/)).toBeTruthy();
      expect(within(dialog).getByText('Owner confirmed shop closed')).toBeTruthy();
    });

    it('a voided adjustment shows who voided it, why, and its reversal', async () => {
      const dialog = await open('Installation fee');
      expect(within(dialog).getByText(/cancelled by a reversal/)).toBeTruthy();
      expect(within(dialog).getByText('Charged the wrong customer')).toBeTruthy();
      expect(within(dialog).getAllByText('Voided')).toHaveLength(2); // the status badge + the history row
      expect(within(dialog).getByText('Reversal posted')).toBeTruthy();
      // "Posted … by Bilal" and "Voided … by Bilal"
      expect(within(dialog).getAllByText(/by Bilal Accountant/)).toHaveLength(2);
    });

    it('a reversal points back at the adjustment it cancels', async () => {
      const dialog = await open('Reversal: Installation fee');
      expect(within(dialog).getByText('Reverses')).toBeTruthy();
      expect(within(dialog).getByText(/Service fee · Installation fee ·/)).toBeTruthy();
    });

    it('a transfer leg links to the OTHER account', async () => {
      const dialog = await open('Balance transferred to C-0002');
      expect(within(dialog).getByText('Balance transfer')).toBeTruthy();
      const link = within(dialog).getByRole('link', { name: /Other account/ });
      expect(link.getAttribute('href')).toBe('/dashboard/customers/cust-2');
    });

    it('closes, and re-opens another row', async () => {
      const dialog = await open('Late payment penalty');
      fireEvent.click(within(dialog).getByRole('button', { name: /close/i }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

      fireEvent.click(screen.getByText('Loyalty discount'));
      expect(await screen.findByRole('dialog')).toBeTruthy();
    });
  });

  describe('error state', () => {
    it('shows an error with a retry, and recovers', async () => {
      list.mockRejectedValueOnce(new Error('boom')).mockResolvedValue(page(ROWS));
      renderTab();

      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toContain('Couldn’t load charges & credits.');
      expect(screen.queryByText('No charges or credits on this account yet.')).toBeNull();

      fireEvent.click(within(alert).getByRole('button', { name: /try again/i }));
      expect(await screen.findByText('Late payment penalty')).toBeTruthy();
      expect(screen.queryByRole('alert')).toBeNull();
    });
  });

  // ── Phase 4B: create ─────────────────────────────────────────────────────────

  describe('create action', () => {
    const newButton = () => screen.queryByRole('button', { name: /new adjustment/i });
    const posted = {
      data: {
        adjustment: { id: 'new-1', kind: 'PENALTY', direction: 'CHARGE', amount: 500, title: 'x' },
        transaction: { id: 't', amount: 500 },
        customerBalance: 1500,
        idempotentReplay: false,
      },
    };

    it.each([
      ['view only', ['view']],
      ['void only', ['void']],
      ['transfer only', ['transfer']],
      ['the legacy money-adjust permission', ['transactions:adjust']],
    ])('is NOT offered to someone with %s', async (_label, perms) => {
      list.mockResolvedValue(page(ROWS));
      grant(...perms);
      renderTab();
      await screen.findByText('Late payment penalty');
      expect(newButton()).toBeNull();
      expect(screen.queryByText(/new charge or credit/i)).toBeNull();
    });

    it.each([['create'], ['create_credit'], ['create_restricted']])('is offered to a holder of %s', async (action) => {
      list.mockResolvedValue(page(ROWS));
      grant(action);
      renderTab();
      await screen.findByText('Late payment penalty');
      expect(newButton()).not.toBeNull();
    });

    it('is still offered on an empty account (that is where the first one gets posted)', async () => {
      list.mockResolvedValue(page([]));
      grant('create');
      renderTab();
      await screen.findByText('No charges or credits on this account yet.');
      expect(newButton()).not.toBeNull();
    });

    it.each([
      [['create'], ['Service fee', 'Penalty', 'Other charge']],
      [['create_credit'], ['Discount', 'Goodwill credit', 'Other credit']],
      [['create_restricted'], ['Write-off', 'Correction']],
      [['create', 'create_credit'], ['Service fee', 'Penalty', 'Other charge', 'Discount', 'Goodwill credit', 'Other credit']],
      [
        ['create', 'create_credit', 'create_restricted'],
        ['Service fee', 'Penalty', 'Other charge', 'Discount', 'Goodwill credit', 'Other credit', 'Write-off', 'Correction'],
      ],
    ])('a user holding %p is offered exactly those kinds', async (actions, expected) => {
      list.mockResolvedValue(page(ROWS));
      grant(...actions);
      renderTab();
      await screen.findByText('Late payment penalty');
      fireEvent.click(newButton() as HTMLElement);

      const dialog = await screen.findByRole('dialog', { name: /new charge or credit/i });
      const kinds = within(within(dialog).getByLabelText(/^Type/)).getAllByRole('option').map((o) => o.textContent);
      expect(kinds).toEqual(expected);
    });

    it('posts, closes, and refreshes the list', async () => {
      list.mockResolvedValue(page(ROWS));
      createApi.mockResolvedValue(posted);
      grant('create');
      renderTab();
      await screen.findByText('Late payment penalty');
      const listCallsBefore = list.mock.calls.length;

      fireEvent.click(newButton() as HTMLElement);
      const dialog = await screen.findByRole('dialog', { name: /new charge or credit/i });
      fireEvent.change(within(dialog).getByLabelText(/^Amount/), { target: { value: '500' } });
      fireEvent.change(within(dialog).getByLabelText(/^Title/), { target: { value: 'Late payment penalty' } });
      fireEvent.click(within(dialog).getByRole('button', { name: /post adjustment/i }));

      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull()); // closed
      expect(createApi).toHaveBeenCalledTimes(1);
      expect(createApi.mock.calls[0][0]).toMatchObject({ customerId: CUSTOMER_ID, kind: 'SERVICE_FEE', amount: 500 });
      await waitFor(() => expect(list.mock.calls.length).toBeGreaterThan(listCallsBefore)); // list refetched
      expect((toast.success as jest.Mock).mock.calls[0][0]).toMatch(/posted/);
    });

    it('a failed post leaves the dialog open with the error and does not refetch the list', async () => {
      list.mockResolvedValue(page(ROWS));
      createApi.mockRejectedValue(
        Object.assign(new Error('x'), { response: { status: 400, data: { message: 'Effective date must be within the current month.' } } }),
      );
      grant('create');
      renderTab();
      await screen.findByText('Late payment penalty');
      const listCallsBefore = list.mock.calls.length;

      fireEvent.click(newButton() as HTMLElement);
      const dialog = await screen.findByRole('dialog', { name: /new charge or credit/i });
      fireEvent.change(within(dialog).getByLabelText(/^Amount/), { target: { value: '500' } });
      fireEvent.change(within(dialog).getByLabelText(/^Title/), { target: { value: 'Late' } });
      fireEvent.click(within(dialog).getByRole('button', { name: /post adjustment/i }));

      expect((await within(dialog).findByRole('alert')).textContent).toMatch(/within the current month/);
      expect(screen.getByRole('dialog', { name: /new charge or credit/i })).toBeTruthy();
      expect(list.mock.calls.length).toBe(listCallsBefore);
    });
  });

  // ── Phase 4B: void ───────────────────────────────────────────────────────────

  describe('void action', () => {
    const openRow = async (title: string) => {
      list.mockResolvedValue(page(ROWS));
      renderTab();
      fireEvent.click(await screen.findByText(title));
      return screen.findByRole('dialog');
    };
    const voidButton = (dialog: HTMLElement) => within(dialog).queryByRole('button', { name: /^void$/i });

    it('is offered on a POSTED adjustment to a holder of `void`', async () => {
      grant('void');
      const dialog = await openRow('Late payment penalty');
      expect(voidButton(dialog)).not.toBeNull();
    });

    it.each([['Late payment penalty'], ['Loyalty discount'], ['Bad debt — closed shop']])(
      'is offered on a POSTED standalone adjustment: %s',
      async (title) => {
        grant('void');
        const dialog = await openRow(title);
        expect(voidButton(dialog)).not.toBeNull();
      },
    );

    it('is NOT offered without the void permission — even to someone who can post', async () => {
      grant('create', 'create_credit', 'create_restricted', 'view', 'transfer');
      const dialog = await openRow('Late payment penalty');
      expect(voidButton(dialog)).toBeNull();
    });

    it('is NOT offered on an already-voided adjustment', async () => {
      grant('void');
      const dialog = await openRow('Installation fee');
      expect(within(dialog).getAllByText('Voided').length).toBeGreaterThan(0);
      expect(voidButton(dialog)).toBeNull();
    });

    it('is NOT offered on a reversal', async () => {
      grant('void');
      const dialog = await openRow('Reversal: Installation fee');
      expect(voidButton(dialog)).toBeNull();
    });

    it('is NOT offered on a transfer leg — which explains why', async () => {
      grant('void');
      const dialog = await openRow('Balance transferred to C-0002');
      expect(voidButton(dialog)).toBeNull();
      expect(within(dialog).getByText(/voided as a whole, not leg by leg/)).toBeTruthy();
    });

    it('voids with the reason, closes everything, and refreshes the list', async () => {
      grant('void');
      voidApi.mockResolvedValue({ data: { adjustment: { id: 'a-penalty', status: 'VOIDED' }, reversal: { id: 'r' }, customerBalance: 500 } });
      const dialog = await openRow('Late payment penalty');
      const listCallsBefore = list.mock.calls.length;

      fireEvent.click(voidButton(dialog) as HTMLElement);
      const voidDialog = await screen.findByRole('dialog', { name: /void adjustment/i });
      fireEvent.change(within(voidDialog).getByLabelText(/^Reason/), { target: { value: 'Charged the wrong customer' } });
      fireEvent.click(within(voidDialog).getByRole('button', { name: /^void adjustment$/i }));

      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull()); // BOTH dialogs closed
      expect(voidApi).toHaveBeenCalledTimes(1);
      expect(voidApi).toHaveBeenCalledWith('a-penalty', 'Charged the wrong customer');
      await waitFor(() => expect(list.mock.calls.length).toBeGreaterThan(listCallsBefore));
    });

    it('requires a reason — the void endpoint is not called without one', async () => {
      grant('void');
      const dialog = await openRow('Late payment penalty');
      fireEvent.click(voidButton(dialog) as HTMLElement);
      const voidDialog = await screen.findByRole('dialog', { name: /void adjustment/i });
      fireEvent.click(within(voidDialog).getByRole('button', { name: /^void adjustment$/i }));
      expect(within(voidDialog).getByText(/reason of at least 5 characters is required/i)).toBeTruthy();
      expect(voidApi).not.toHaveBeenCalled();
    });

    it('Cancel returns to the detail view (nothing voided)', async () => {
      grant('void');
      const dialog = await openRow('Late payment penalty');
      fireEvent.click(voidButton(dialog) as HTMLElement);
      const voidDialog = await screen.findByRole('dialog', { name: /void adjustment/i });
      fireEvent.click(within(voidDialog).getByRole('button', { name: /^cancel$/i }));

      await waitFor(() => expect(screen.queryByRole('dialog', { name: /void adjustment/i })).toBeNull());
      expect(screen.getByRole('dialog', { name: /Penalty/ })).toBeTruthy(); // the detail is still there
      expect(voidApi).not.toHaveBeenCalled();
    });

    it('a failed void keeps both dialogs open and shows the error', async () => {
      grant('void');
      voidApi.mockRejectedValue(
        Object.assign(new Error('x'), { response: { status: 409, data: { message: 'This adjustment has already been voided.' } } }),
      );
      const dialog = await openRow('Late payment penalty');
      fireEvent.click(voidButton(dialog) as HTMLElement);
      const voidDialog = await screen.findByRole('dialog', { name: /void adjustment/i });
      fireEvent.change(within(voidDialog).getByLabelText(/^Reason/), { target: { value: 'Entered in error' } });
      fireEvent.click(within(voidDialog).getByRole('button', { name: /^void adjustment$/i }));

      expect((await within(voidDialog).findByRole('alert')).textContent).toMatch(/already been voided/);
      expect(screen.getByRole('dialog', { name: /void adjustment/i })).toBeTruthy();
    });
  });
});
