import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { CustomerList } from './customer-list';
import {
  useCustomers,
  useDeactivateCustomer,
  useDeleteCustomer,
  useReactivateCustomer,
} from '../hooks/use-customers';
import { useAuthStore } from '../../../store/auth.store';

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

jest.mock('nuqs', () => ({
  useQueryState: () => ['', jest.fn()],
  parseAsString: { withDefault: () => ({}) },
  parseAsInteger: { withDefault: () => ({}) },
}));

jest.mock('@water-supply-crm/ui', () => {
  const actual = jest.requireActual('@water-supply-crm/ui');
  return {
    ...actual,
    DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DropdownMenuItem: ({
      children,
      onClick,
      asChild,
    }: {
      children: React.ReactNode;
      onClick?: () => void;
      asChild?: boolean;
    }) => (asChild ? <div>{children}</div> : <button onClick={onClick}>{children}</button>),
    Sheet: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SheetContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SheetHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SheetTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  };
});

jest.mock('../../../components/shared/data-table', () => ({
  DataTable: ({
    data,
    columns,
    emptyMessage,
  }: {
    data?: Array<Record<string, unknown>>;
    columns: Array<{ key: string; header: string; cell: (row: Record<string, unknown>) => React.ReactNode }>;
    emptyMessage: string;
  }) =>
    data?.length ? (
      <div>
        {data.map((row) => (
          <div key={String(row.id)}>
            {columns.map((column) => (
              <div key={column.key}>
                <span>{column.header}</span>
                <div>{column.cell(row)}</div>
              </div>
            ))}
          </div>
        ))}
      </div>
    ) : (
      <div>{emptyMessage}</div>
    ),
}));

jest.mock('../../../components/shared/confirm-dialog', () => ({
  ConfirmDialog: ({
    open,
    title,
    onConfirm,
    confirmLabel,
  }: {
    open: boolean;
    title: string;
    onConfirm: () => void;
    confirmLabel: string;
  }) =>
    open ? (
      <div>
        <div>{title}</div>
        <button onClick={onConfirm}>{confirmLabel}</button>
      </div>
    ) : null,
}));

jest.mock('../../../components/shared/filters/search-input', () => ({
  SearchInput: () => <div>Search Filter</div>,
}));

jest.mock('../../../components/shared/filters/route-filter', () => ({
  RouteFilter: () => <div>Route Filter</div>,
}));

jest.mock('../../../components/shared/filters/van-filter', () => ({
  VanFilter: () => <div>Van Filter</div>,
}));

jest.mock('./customer-form', () => ({
  CustomerForm: ({ open, customer }: { open: boolean; customer?: { name?: string } }) =>
    open ? <div>Editing {customer?.name}</div> : null,
}));

jest.mock('../hooks/use-customers', () => ({
  useCustomers: jest.fn(),
  useDeactivateCustomer: jest.fn(),
  useDeleteCustomer: jest.fn(),
  useReactivateCustomer: jest.fn(),
}));

jest.mock('../../../store/auth.store', () => ({
  useAuthStore: jest.fn(),
}));

const mockUseCustomers = useCustomers as jest.MockedFunction<typeof useCustomers>;
const mockUseDeactivateCustomer = useDeactivateCustomer as jest.MockedFunction<typeof useDeactivateCustomer>;
const mockUseDeleteCustomer = useDeleteCustomer as jest.MockedFunction<typeof useDeleteCustomer>;
const mockUseReactivateCustomer = useReactivateCustomer as jest.MockedFunction<typeof useReactivateCustomer>;
const mockUseAuthStore = useAuthStore as jest.MockedFunction<typeof useAuthStore>;

describe('CustomerList', () => {
  const deactivate = jest.fn();
  const remove = jest.fn();
  const reactivate = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAuthStore.mockImplementation((selector) =>
      selector({
        user: {
          id: 'vendor-user',
          name: 'Vendor Admin',
          email: 'admin@example.com',
          role: 'VENDOR_ADMIN',
          vendorId: 'vendor-1',
        },
      } as never)
    );
    mockUseCustomers.mockReturnValue({
      data: {
        data: [
          {
            id: 'customer-1',
            name: 'Ahmed Ali',
            phoneNumber: '03001234567',
            address: 'Street 1',
            customerCode: 'CUS-001',
            paymentType: 'MONTHLY',
            route: { name: 'Central' },
            financialBalance: 1200,
            deliverySchedules: [{ dayOfWeek: 1 }],
            isActive: true,
          },
          {
            id: 'customer-2',
            name: 'Sara Khan',
            phoneNumber: '03007654321',
            address: 'Street 2',
            customerCode: 'CUS-002',
            paymentType: 'CASH',
            financialBalance: 0,
            deliverySchedules: [],
            isActive: false,
          },
        ],
        meta: { total: 2 },
      },
      isLoading: false,
      page: 1,
      setPage: jest.fn(),
      limit: 20,
      setLimit: jest.fn(),
      isActive: '',
      setIsActive: jest.fn(),
    } as ReturnType<typeof useCustomers>);
    mockUseDeactivateCustomer.mockReturnValue({
      mutate: deactivate,
      isPending: false,
    } as ReturnType<typeof useDeactivateCustomer>);
    mockUseDeleteCustomer.mockReturnValue({
      mutate: remove,
      isPending: false,
    } as ReturnType<typeof useDeleteCustomer>);
    mockUseReactivateCustomer.mockReturnValue({
      mutate: reactivate,
      isPending: false,
    } as ReturnType<typeof useReactivateCustomer>);
  });

  it('renders live customer rows and deactivates active customers through the confirm flow', () => {
    render(<CustomerList />);

    expect(screen.getByText('Ahmed Ali')).toBeTruthy();
    expect(screen.getByText('CUS-001')).toBeTruthy();
    expect(screen.getByText('Sara Khan')).toBeTruthy();
    expect(screen.getByText('OFF')).toBeTruthy();

    fireEvent.click(screen.getAllByRole('button', { name: 'Deactivate' })[0]);
    fireEvent.click(screen.getAllByRole('button', { name: 'Deactivate' })[1]);

    expect(deactivate).toHaveBeenCalledWith('customer-1', expect.any(Object));
  });

  it('reactivates inactive customers immediately from the actions list', () => {
    render(<CustomerList />);

    fireEvent.click(screen.getByRole('button', { name: 'Reactivate' }));

    expect(reactivate).toHaveBeenCalledWith('customer-2');
  });
});
