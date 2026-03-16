import React from 'react';
import { render, screen } from '@testing-library/react';
import { SheetList } from './sheet-list';
import { useDailySheets } from '../hooks/use-daily-sheets';
import { useAuthStore } from '../../../store/auth.store';

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

jest.mock('nuqs', () => ({
  useQueryState: () => ['', jest.fn()],
  parseAsString: { withDefault: () => ({}) },
}));

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

jest.mock('../../../components/shared/status-badge', () => ({
  StatusBadge: ({ status }: { status: string }) => <span>{status}</span>,
}));

jest.mock('../../../components/shared/date-range-picker', () => ({
  DateRangePicker: () => <div>Date Range</div>,
}));

jest.mock('../../../components/shared/filters/route-filter', () => ({
  RouteFilter: () => <div>Route Filter</div>,
}));

jest.mock('../../../components/shared/filters/van-filter', () => ({
  VanFilter: () => <div>Van Filter</div>,
}));

jest.mock('../../../components/shared/filters/driver-filter', () => ({
  DriverFilter: () => <div>Driver Filter</div>,
}));

jest.mock('../hooks/use-daily-sheets', () => ({
  useDailySheets: jest.fn(),
}));

jest.mock('../../../store/auth.store', () => ({
  useAuthStore: jest.fn(),
}));

const mockUseDailySheets = useDailySheets as jest.MockedFunction<typeof useDailySheets>;
const mockUseAuthStore = useAuthStore as jest.MockedFunction<typeof useAuthStore>;

describe('SheetList', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseDailySheets.mockReturnValue({
      data: {
        data: [
          {
            id: 'sheet-open',
            date: '2026-03-16T00:00:00.000Z',
            isClosed: false,
            filledOutCount: 0,
            filledInCount: 0,
            emptyInCount: 0,
            cashCollected: 0,
            route: { name: 'Central' },
            driver: { name: 'Ali' },
            van: { plateNumber: 'LEA-123' },
          },
          {
            id: 'sheet-loaded',
            date: '2026-03-17T00:00:00.000Z',
            isClosed: false,
            filledOutCount: 20,
            filledInCount: 0,
            emptyInCount: 0,
            cashCollected: 0,
            route: { name: 'North' },
            driver: { name: 'Sara' },
            van: { plateNumber: 'LEA-456' },
          },
          {
            id: 'sheet-checkin',
            date: '2026-03-18T00:00:00.000Z',
            isClosed: false,
            filledOutCount: 20,
            filledInCount: 5,
            emptyInCount: 5,
            cashCollected: 1000,
            route: { name: 'South' },
            driver: { name: 'Khan' },
            van: { plateNumber: 'LEA-789' },
          },
          {
            id: 'sheet-closed',
            date: '2026-03-19T00:00:00.000Z',
            isClosed: true,
            filledOutCount: 10,
            filledInCount: 10,
            emptyInCount: 10,
            cashCollected: 500,
            route: { name: 'West' },
            driver: { name: 'Imran' },
            van: { plateNumber: 'LEA-010' },
          },
        ],
        meta: { total: 4 },
      },
      isLoading: false,
      page: 1,
      setPage: jest.fn(),
      limit: 20,
      setLimit: jest.fn(),
      routeId: '',
      vanId: '',
      driverId: '',
    } as ReturnType<typeof useDailySheets>);
  });

  it('computes and renders live operational statuses for staff users', () => {
    mockUseAuthStore.mockImplementation((selector) =>
      selector({
        user: {
          id: 'staff-1',
          role: 'STAFF',
        },
      } as never)
    );

    render(<SheetList />);

    expect(screen.getByText('OPEN')).toBeTruthy();
    expect(screen.getByText('LOADED')).toBeTruthy();
    expect(screen.getByText('CHECKED_IN')).toBeTruthy();
    expect(screen.getByText('CLOSED')).toBeTruthy();
    expect(screen.getByText('Delivery Issues Inbox')).toBeTruthy();
  });

  it('hides staff-only controls for drivers', () => {
    mockUseAuthStore.mockImplementation((selector) =>
      selector({
        user: {
          id: 'driver-1',
          role: 'DRIVER',
        },
      } as never)
    );

    render(<SheetList />);

    expect(screen.queryByText('Delivery Issues Inbox')).toBeNull();
    expect(screen.queryByText('Driver Filter')).toBeNull();
  });
});
