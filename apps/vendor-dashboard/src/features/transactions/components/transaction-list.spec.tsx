import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { TransactionList } from './transaction-list';
import { useTransactions } from '../hooks/use-transactions';
import { useAllVans } from '../../vans/hooks/use-vans';
import { useAllCustomers } from '../../customers/hooks/use-customers';

jest.mock('../../../components/shared/data-table', () => ({
  DataTable: ({
    data,
    columns,
  }: {
    data?: Array<Record<string, unknown>>;
    columns: Array<{ key: string; header: string; cell: (row: Record<string, unknown>) => React.ReactNode }>;
  }) => (
    <div>
      {data?.map((row) => (
        <div key={String(row.id)}>
          {columns.map((column) => (
            <div key={column.key}>{column.cell(row)}</div>
          ))}
        </div>
      ))}
    </div>
  ),
}));

jest.mock('../../../components/shared/filters/search-input', () => ({
  SearchInput: () => <div>Search Filter</div>,
}));

jest.mock('../../../components/shared/date-range-picker', () => ({
  DateRangePicker: () => <div>Date Range</div>,
}));

jest.mock('./payment-form', () => ({
  PaymentForm: ({ open, customerId }: { open: boolean; customerId: string }) =>
    open ? <div>Payment Form {customerId}</div> : null,
}));

jest.mock('../hooks/use-transactions', () => ({
  useTransactions: jest.fn(),
}));

jest.mock('../../vans/hooks/use-vans', () => ({
  useAllVans: jest.fn(),
}));

jest.mock('../../customers/hooks/use-customers', () => ({
  useAllCustomers: jest.fn(),
}));

const mockUseTransactions = useTransactions as jest.MockedFunction<typeof useTransactions>;
const mockUseAllVans = useAllVans as jest.MockedFunction<typeof useAllVans>;
const mockUseAllCustomers = useAllCustomers as jest.MockedFunction<typeof useAllCustomers>;

describe('TransactionList', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseTransactions.mockReturnValue({
      data: {
        data: [
          {
            id: 'tx-1',
            type: 'PAYMENT',
            amount: -2500,
            createdAt: '2026-03-16T00:00:00.000Z',
            customer: { name: 'Ahmed Ali' },
            description: 'Cash payment',
          },
          {
            id: 'tx-2',
            type: 'ADJUSTMENT',
            amount: 500,
            createdAt: '2026-03-17T00:00:00.000Z',
            customer: { name: 'Sara Khan' },
            description: 'Ledger correction',
          },
        ],
        meta: { total: 2 },
      },
      isLoading: false,
      page: 1,
      setPage: jest.fn(),
      limit: 20,
      setLimit: jest.fn(),
      search: '',
      setSearch: jest.fn(),
      customerId: '',
      setCustomerId: jest.fn(),
      vanId: '',
      setVanId: jest.fn(),
      type: '',
      setType: jest.fn(),
      dateFrom: '',
      setDateFrom: jest.fn(),
      dateTo: '',
      setDateTo: jest.fn(),
    } as ReturnType<typeof useTransactions>);
    mockUseAllVans.mockReturnValue({
      data: { data: [{ id: 'van-1', plateNumber: 'LEA-123' }] },
    } as ReturnType<typeof useAllVans>);
    mockUseAllCustomers.mockReturnValue({
      data: { data: [{ id: 'customer-1', name: 'Ahmed Ali', customerCode: 'CUS-001' }] },
    } as ReturnType<typeof useAllCustomers>);
  });

  it('renders signed transaction amounts using the live list formatting', () => {
    render(<TransactionList />);

    expect(screen.getByText((content) => content.includes('- ₨ 2,500'))).toBeTruthy();
    expect(screen.getByText((content) => content.includes('+ ₨ 500'))).toBeTruthy();
    expect(screen.getByText('Cash payment')).toBeTruthy();
    expect(screen.getByText('Ledger correction')).toBeTruthy();
  });

  it('opens the payment form when rendered for a specific customer', () => {
    render(<TransactionList customerId="customer-1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Record Payment' }));

    expect(screen.getByText('Payment Form customer-1')).toBeTruthy();
  });
});
