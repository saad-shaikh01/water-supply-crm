import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { crewCashApi } from '../api/crew-cash.api';
import { CrewCashForm } from './crew-cash-form';

jest.mock('../api/crew-cash.api', () => ({
  crewCashApi: { create: jest.fn(), update: jest.fn(), remove: jest.fn(), correct: jest.fn(), getForSheet: jest.fn() },
}));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), warning: jest.fn(), error: jest.fn() } }));
// The real picker is a Radix Select + a users query — a native select keeps the form logic testable.
jest.mock('./employee-select', () => ({
  EmployeeSelect: ({ value, onChange, crew, disabled }: any) => (
    <select aria-label="Employee" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      <option value="">Select employee</option>
      {crew.map((c: any) => (
        <option key={c.id} value={c.id}>{c.name}</option>
      ))}
    </select>
  ),
}));

const createApi = crewCashApi.create as jest.Mock;

const CREW = [{ id: 'emp-1', name: 'Ali' }];

function setup(props: { isClosed?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = jest.spyOn(client, 'invalidateQueries');
  render(
    <QueryClientProvider client={client}>
      <CrewCashForm open onOpenChange={jest.fn()} sheetId="sheet-1" employees={CREW} {...props} />
    </QueryClientProvider>,
  );
  return { invalidate };
}

const fill = () => {
  fireEvent.change(screen.getByLabelText('Employee'), { target: { value: 'emp-1' } });
  fireEvent.click(screen.getByRole('button', { name: /meal/i }));
  fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '200' } });
};
const recordBtn = () => screen.getByRole('button', { name: /^record$/i }) as HTMLButtonElement;
const reasonField = () => screen.queryByPlaceholderText(/after the sheet closed/) as HTMLTextAreaElement | null;

describe('CrewCashForm', () => {
  beforeEach(() => createApi.mockReset().mockResolvedValue({ data: { possibleDuplicate: false } }));

  describe('open sheet', () => {
    it('shows no closed-sheet notice or reason field, and sends no reason', async () => {
      setup();
      expect(screen.queryByText(/This sheet is closed/)).toBeNull();
      expect(reasonField()).toBeNull();

      fill();
      fireEvent.click(recordBtn());
      await waitFor(() => expect(createApi).toHaveBeenCalledTimes(1));
      expect(createApi).toHaveBeenCalledWith('sheet-1', { employeeId: 'emp-1', category: 'MEAL', amount: 200, notes: undefined });
    });

    it('refreshes the sheet detail too — totals and hand-in figures derive from it', async () => {
      const { invalidate } = setup();
      fill();
      fireEvent.click(recordBtn());
      await waitFor(() => expect(createApi).toHaveBeenCalled());
      await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['sheets', 'sheet-1'] }));
    });
  });

  describe('closed sheet', () => {
    it('shows the notice and blocks submit until a reason of 3+ characters is given', () => {
      setup({ isClosed: true });
      expect(screen.getByRole('dialog').textContent).toMatch(/This sheet is closed/);
      expect(screen.getByRole('dialog').textContent).toMatch(/Add Crew Cash \(Closed Sheet\)/);

      fill();
      expect(recordBtn().disabled).toBe(true);
      fireEvent.change(reasonField()!, { target: { value: 'ab' } });
      expect(recordBtn().disabled).toBe(true);
      fireEvent.change(reasonField()!, { target: { value: 'forgot to log' } });
      expect(recordBtn().disabled).toBe(false);
    });

    it('sends the trimmed reason with the entry', async () => {
      setup({ isClosed: true });
      fill();
      fireEvent.change(reasonField()!, { target: { value: '  forgot to log  ' } });
      fireEvent.click(recordBtn());
      await waitFor(() => expect(createApi).toHaveBeenCalledTimes(1));
      expect(createApi).toHaveBeenCalledWith('sheet-1', {
        employeeId: 'emp-1',
        category: 'MEAL',
        amount: 200,
        notes: undefined,
        reason: 'forgot to log',
      });
    });
  });
});
