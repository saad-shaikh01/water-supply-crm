import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SheetAdvanceEntry } from '@water-supply-crm/types';
import { sheetAdvancesApi } from '../api/sheet-advances.api';
import { DeleteAdvanceDialog } from './delete-advance-dialog';

jest.mock('../api/sheet-advances.api', () => ({
  sheetAdvancesApi: { create: jest.fn(), update: jest.fn(), remove: jest.fn() },
}));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const removeApi = sheetAdvancesApi.remove as jest.Mock;

const entry = (o: Partial<SheetAdvanceEntry> = {}): SheetAdvanceEntry => ({
  id: 'adv-1',
  dailySheetId: 'sheet-1',
  employeeId: 'emp-1',
  employee: { id: 'emp-1', name: 'Ali' },
  amount: 1500,
  notes: 'for rent',
  date: '2026-10-01T00:00:00.000Z',
  status: 'ACTIVE',
  version: 1,
  createdById: 'u1',
  createdBy: { id: 'u1', name: 'Manager' },
  staffLedgerEntry: { id: 'led-1', status: 'POSTED', payrollEntryId: null },
  ...o,
});

function setup(props: { entry?: SheetAdvanceEntry; isClosed: boolean }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const onClose = jest.fn();
  render(
    <QueryClientProvider client={client}>
      <DeleteAdvanceDialog open onClose={onClose} sheetId="sheet-1" entry={props.entry ?? entry()} isClosed={props.isClosed} />
    </QueryClientProvider>,
  );
  return { onClose };
}

const deleteBtn = () => screen.getByRole('button', { name: /^delete advance$/i }) as HTMLButtonElement;
const reasonField = () => screen.getByPlaceholderText(/Why is this advance being removed|Optional/) as HTMLTextAreaElement;

describe('DeleteAdvanceDialog', () => {
  beforeEach(() => removeApi.mockReset().mockResolvedValue({ data: {} }));

  it('summarises the advance and what deleting does', () => {
    setup({ isClosed: false });
    const text = screen.getByRole('dialog').textContent ?? '';
    expect(text).toMatch(/₨ 1,500 · Ali/);
    expect(text).toMatch(/for rent/);
    expect(text).toMatch(/voided on the employee.s payroll ledger/);
    expect(text).toMatch(/goes back into the day.s cash hand-in/);
  });

  it('on an OPEN sheet the reason is optional — deletes straight away without one', async () => {
    const { onClose } = setup({ isClosed: false });
    expect(deleteBtn().disabled).toBe(false);
    fireEvent.click(deleteBtn());
    await waitFor(() => expect(removeApi).toHaveBeenCalledTimes(1));
    expect(removeApi).toHaveBeenCalledWith('adv-1', undefined);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('on a CLOSED sheet the reason is mandatory (3+ chars) and is sent trimmed', async () => {
    setup({ isClosed: true });
    expect(deleteBtn().disabled).toBe(true);
    fireEvent.change(reasonField(), { target: { value: 'ab' } });
    expect(deleteBtn().disabled).toBe(true);

    fireEvent.change(reasonField(), { target: { value: '  entered twice  ' } });
    expect(deleteBtn().disabled).toBe(false);
    fireEvent.click(deleteBtn());
    await waitFor(() => expect(removeApi).toHaveBeenCalledTimes(1));
    expect(removeApi).toHaveBeenCalledWith('adv-1', 'entered twice');
    expect(screen.getByRole('dialog').textContent ?? '').toMatch(/close-time cash figure stays as it was/);
  });

  it('warns that an advance already used by payroll is reversed in the current period, not erased', () => {
    setup({ isClosed: false, entry: entry({ staffLedgerEntry: { id: 'led-1', status: 'POSTED', payrollEntryId: 'pe-1' } }) });
    expect(screen.getByRole('dialog').textContent).toMatch(/reversed in the current payroll period instead of being erased/);
  });
});
