import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SheetAdvanceEntry } from '@water-supply-crm/types';
import { sheetAdvancesApi } from '../api/sheet-advances.api';
import { AdvanceFormDialog } from './advance-form-dialog';

jest.mock('../api/sheet-advances.api', () => ({
  sheetAdvancesApi: { create: jest.fn(), update: jest.fn(), remove: jest.fn() },
}));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
// The real picker is a Radix Select + a users query — irrelevant here; a native select keeps the form logic testable.
jest.mock('../../crew-cash/components/employee-select', () => ({
  EmployeeSelect: ({ value, onChange, crew }: any) => (
    <select aria-label="Employee" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Select employee</option>
      {crew.map((c: any) => (
        <option key={c.id} value={c.id}>{c.name}</option>
      ))}
    </select>
  ),
}));

const createApi = sheetAdvancesApi.create as jest.Mock;
const updateApi = sheetAdvancesApi.update as jest.Mock;

const CREW = [
  { id: 'emp-1', name: 'Ali' },
  { id: 'emp-2', name: 'Bilal' },
];

const entry = (o: Partial<SheetAdvanceEntry> = {}): SheetAdvanceEntry => ({
  id: 'adv-1',
  dailySheetId: 'sheet-1',
  employeeId: 'emp-1',
  employee: { id: 'emp-1', name: 'Ali' },
  amount: 500,
  notes: null,
  date: '2026-10-01T00:00:00.000Z',
  status: 'ACTIVE',
  version: 3,
  createdById: 'u1',
  createdBy: { id: 'u1', name: 'Manager' },
  ...o,
});

function setup(props: { entry?: SheetAdvanceEntry | null; isClosed?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = jest.spyOn(client, 'invalidateQueries');
  const onOpenChange = jest.fn();
  render(
    <QueryClientProvider client={client}>
      <AdvanceFormDialog open onOpenChange={onOpenChange} sheetId="sheet-1" crew={CREW} {...props} />
    </QueryClientProvider>,
  );
  return { invalidate, onOpenChange };
}

const amountField = () => screen.getByPlaceholderText('0') as HTMLInputElement;
const employeeField = () => screen.getByLabelText('Employee') as HTMLSelectElement;
const reasonField = () => screen.queryByPlaceholderText(/after the sheet closed|What was wrong/) as HTMLTextAreaElement | null;
const recordBtn = () => screen.getByRole('button', { name: /^record$/i }) as HTMLButtonElement;
const updateBtn = () => screen.getByRole('button', { name: /^update$/i }) as HTMLButtonElement;

describe('AdvanceFormDialog', () => {
  beforeEach(() => {
    createApi.mockReset().mockResolvedValue({ data: {} });
    updateApi.mockReset().mockResolvedValue({ data: {} });
  });

  describe('add on an OPEN sheet', () => {
    it('explains the cash + payroll effect and asks for no reason', () => {
      setup();
      expect(screen.getByRole('dialog').textContent).toMatch(/deducted from the day.s cash hand-in/);
      expect(screen.queryByText(/This sheet is closed/)).toBeNull();
      expect(reasonField()).toBeNull();
    });

    it('needs an employee and a positive amount before it can be recorded', () => {
      setup();
      expect(recordBtn().disabled).toBe(true);
      fireEvent.change(employeeField(), { target: { value: 'emp-2' } });
      expect(recordBtn().disabled).toBe(true);
      fireEvent.change(amountField(), { target: { value: '750' } });
      expect(recordBtn().disabled).toBe(false);
    });

    it('records the advance without a reason, closes, and refreshes the sheet and the Cash Ledger', async () => {
      const { invalidate, onOpenChange } = setup();
      fireEvent.change(employeeField(), { target: { value: 'emp-2' } });
      fireEvent.change(amountField(), { target: { value: '750' } });
      fireEvent.change(screen.getByPlaceholderText('Optional notes...'), { target: { value: ' for rent ' } });
      fireEvent.click(recordBtn());

      await waitFor(() => expect(createApi).toHaveBeenCalledTimes(1));
      expect(createApi).toHaveBeenCalledWith('sheet-1', { employeeId: 'emp-2', amount: 750, notes: 'for rent' });
      await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['sheets', 'sheet-1'] });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['van-cash-ledger'] });
    });

    it('truncates a fractional amount to whole rupees', () => {
      setup();
      fireEvent.change(amountField(), { target: { value: '99.9' } });
      expect(amountField().value).toBe('99');
    });
  });

  describe('add on a CLOSED sheet', () => {
    it('shows the closed-sheet notice and blocks submit until a reason of 3+ characters is given', () => {
      setup({ isClosed: true });
      expect(screen.getByRole('dialog').textContent).toMatch(/This sheet is closed/);
      fireEvent.change(employeeField(), { target: { value: 'emp-1' } });
      fireEvent.change(amountField(), { target: { value: '500' } });
      expect(recordBtn().disabled).toBe(true);

      fireEvent.change(reasonField()!, { target: { value: 'ab' } });
      expect(recordBtn().disabled).toBe(true);
      fireEvent.change(reasonField()!, { target: { value: 'driver forgot' } });
      expect(recordBtn().disabled).toBe(false);
    });

    it('sends the trimmed reason with the advance', async () => {
      setup({ isClosed: true });
      fireEvent.change(employeeField(), { target: { value: 'emp-1' } });
      fireEvent.change(amountField(), { target: { value: '500' } });
      fireEvent.change(reasonField()!, { target: { value: '  driver forgot  ' } });
      fireEvent.click(recordBtn());

      await waitFor(() => expect(createApi).toHaveBeenCalledTimes(1));
      expect(createApi).toHaveBeenCalledWith('sheet-1', {
        employeeId: 'emp-1',
        amount: 500,
        notes: undefined,
        reason: 'driver forgot',
      });
    });
  });

  describe('edit', () => {
    it('pre-fills the row and cannot be saved until something changes', () => {
      setup({ entry: entry() });
      expect(employeeField().value).toBe('emp-1');
      expect(amountField().value).toBe('500');
      expect(updateBtn().disabled).toBe(true);
      expect(screen.getByRole('dialog').textContent).toMatch(/Change the employee, amount or notes to save/);
    });

    it('sends ONLY the changed fields plus the optimistic-concurrency version', async () => {
      setup({ entry: entry({ version: 3 }) });
      fireEvent.change(amountField(), { target: { value: '700' } });
      fireEvent.click(updateBtn());

      await waitFor(() => expect(updateApi).toHaveBeenCalledTimes(1));
      expect(updateApi).toHaveBeenCalledWith('adv-1', { version: 3, amount: 700 });
    });

    it('can re-target another employee', async () => {
      setup({ entry: entry() });
      fireEvent.change(employeeField(), { target: { value: 'emp-2' } });
      fireEvent.click(updateBtn());
      await waitFor(() => expect(updateApi).toHaveBeenCalledTimes(1));
      expect(updateApi).toHaveBeenCalledWith('adv-1', { version: 3, employeeId: 'emp-2' });
    });

    it('on a closed sheet also requires and sends a reason', async () => {
      setup({ entry: entry(), isClosed: true });
      fireEvent.change(amountField(), { target: { value: '700' } });
      expect(updateBtn().disabled).toBe(true);

      fireEvent.change(reasonField()!, { target: { value: 'wrong amount' } });
      fireEvent.click(updateBtn());
      await waitFor(() => expect(updateApi).toHaveBeenCalledTimes(1));
      expect(updateApi).toHaveBeenCalledWith('adv-1', { version: 3, amount: 700, reason: 'wrong amount' });
    });
  });
});
