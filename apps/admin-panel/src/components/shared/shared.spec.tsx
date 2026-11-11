import { render, screen, fireEvent } from '@testing-library/react';
import { PageHeader } from './page-header';
import { EmptyState } from './empty-state';
import { ErrorState } from './error-state';
import { DataTable } from './data-table';

describe('PageHeader', () => {
  it('renders one h1, description and actions', () => {
    render(<PageHeader title="Vendors" description="Manage" actions={<button>Add</button>} />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByText('Manage')).toBeTruthy();
    expect(screen.getByText('Add')).toBeTruthy();
  });
});

describe('EmptyState', () => {
  it('shows title and fires the action', () => {
    const onClick = jest.fn();
    render(<EmptyState title="Nothing" action={<button onClick={onClick}>Create</button>} />);
    expect(screen.getByText('Nothing')).toBeTruthy();
    fireEvent.click(screen.getByText('Create'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe('ErrorState', () => {
  it.each([
    [{ response: { status: 403 } }, 'permission'],
    [{ response: { status: 429 } }, 'Too many requests'],
    [{ code: 'ERR_NETWORK', message: 'Network Error' }, 'Cannot reach the server'],
    [{ response: { status: 400, data: { message: ['a bad', 'b bad'] } } }, 'a bad b bad'],
  ])('maps %j', (err, text) => {
    render(<ErrorState error={err} />);
    expect(screen.getByRole('alert').textContent).toContain(text);
  });

  it('calls onRetry', () => {
    const onRetry = jest.fn();
    render(<ErrorState error={new Error('x')} onRetry={onRetry} />);
    fireEvent.click(screen.getByText('Retry'));
    expect(onRetry).toHaveBeenCalled();
  });
});

describe('DataTable', () => {
  const columns = [{ key: 'n', header: 'Name', cell: (r: { id: string; n: string }) => r.n }];

  it('loading shows skeleton, no empty text', () => {
    render(<DataTable columns={columns} rows={[]} rowKey={(r) => r.id} isLoading empty={{ title: 'None' }} />);
    expect(screen.getAllByTestId('skeleton-row').length).toBeGreaterThan(0);
    expect(screen.queryByText('None')).toBeNull();
  });

  it('error shows alert with retry', () => {
    const onRetry = jest.fn();
    render(<DataTable columns={columns} rows={[]} rowKey={(r) => r.id} error={new Error('x')} onRetry={onRetry} />);
    fireEvent.click(screen.getByText('Retry'));
    expect(onRetry).toHaveBeenCalled();
  });

  it('empty shows EmptyState', () => {
    render(<DataTable columns={columns} rows={[]} rowKey={(r) => r.id} empty={{ title: 'None here' }} />);
    expect(screen.getByText('None here')).toBeTruthy();
  });

  it('renders rows and fires pagination callbacks', () => {
    const onPageChange = jest.fn();
    render(
      <DataTable
        columns={columns}
        rows={[{ id: 'a', n: 'Alpha' }, { id: 'b', n: 'Beta' }]}
        rowKey={(r) => r.id}
        pagination={{ page: 2, limit: 10, total: 40, onPageChange, onLimitChange: jest.fn() }}
      />,
    );
    expect(screen.getByText('Alpha')).toBeTruthy();
    expect(screen.getByText('Beta')).toBeTruthy();
    const buttons = screen.getAllByRole('button').filter((b) => b.getAttribute('role') !== 'combobox');
    // order: first, prev, next, last
    fireEvent.click(buttons[0]);
    fireEvent.click(buttons[1]);
    fireEvent.click(buttons[2]);
    fireEvent.click(buttons[3]);
    expect(onPageChange.mock.calls.map((c) => c[0])).toEqual([1, 1, 3, 4]);
  });
});
