import { act, fireEvent, render, screen } from '@testing-library/react';
import { navigationMockFactory, routerMock, setMockNavigation } from '../../../../test/mocks/next-navigation';
import { AuditFilters, type AuditFilterValues } from './audit-filters';
import { AuditDetailDrawer } from './audit-detail-drawer';
import { buildAuditQuery } from '../hooks/use-audit-logs';
import { useUrlFilters } from '../../observability/hooks/use-url-filters';
import type { AuditRow } from '../api/audit.api';

jest.mock('next/navigation', () => navigationMockFactory());
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn(), warning: jest.fn() } }));

const empty: AuditFilterValues = { vendorId: '', action: '', entity: '', user: '', from: '', to: '' };
const vendors = [{ id: 'v1', name: 'Aqua One' }];

describe('AuditFilters', () => {
  it('forwards select changes', () => {
    const onChange = jest.fn();
    render(<AuditFilters values={empty} vendors={vendors} facets={{ actions: ['UPDATE'], entities: ['Vendor'] }} onChange={onChange} onClear={jest.fn()} />);
    fireEvent.change(screen.getByLabelText('Vendor'), { target: { value: 'v1' } });
    expect(onChange).toHaveBeenCalledWith({ vendorId: 'v1' });
    fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'UPDATE' } });
    expect(onChange).toHaveBeenCalledWith({ action: 'UPDATE' });
  });

  it('debounces the user input', () => {
    jest.useFakeTimers();
    const onChange = jest.fn();
    render(<AuditFilters values={empty} vendors={vendors} onChange={onChange} onClear={jest.fn()} debounceMs={400} />);
    const box = screen.getByLabelText('User (name or ID)');
    fireEvent.change(box, { target: { value: 'ali' } });
    fireEvent.change(box, { target: { value: 'alice' } });
    expect(onChange).not.toHaveBeenCalled();
    act(() => {
      jest.advanceTimersByTime(450);
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ user: 'alice' });
    jest.useRealTimers();
  });

  it('shows Clear only with active filters', () => {
    const onClear = jest.fn();
    const { rerender } = render(<AuditFilters values={empty} vendors={[]} onChange={jest.fn()} onClear={onClear} />);
    expect(screen.queryByText('Clear filters')).toBeNull();
    rerender(<AuditFilters values={{ ...empty, action: 'X' }} vendors={[]} onChange={jest.fn()} onClear={onClear} />);
    fireEvent.click(screen.getByText('Clear filters'));
    expect(onClear).toHaveBeenCalled();
  });
});

describe('buildAuditQuery', () => {
  it('maps UUID user to userId and text to q; drops empties', () => {
    const uuid = '123e4567-e89b-12d3-a456-426614174000';
    expect(buildAuditQuery({ ...empty, user: uuid }, 2, 20)).toEqual({ userId: uuid, page: 2, limit: 20 });
    expect(buildAuditQuery({ ...empty, user: 'bob', from: '2026-01-01' }, 1, 20)).toEqual({ q: 'bob', from: '2026-01-01', page: 1, limit: 20 });
  });
});

function Harness({ onApi }: { onApi: (a: ReturnType<typeof useUrlFilters>) => void }) {
  onApi(useUrlFilters(['action', 'vendorId'] as const));
  return null;
}

describe('URL filter state', () => {
  beforeEach(() => routerMock.replace.mockClear());

  it('reads page from the URL and keeps it when filters are unchanged', () => {
    setMockNavigation('/audit-logs', 'page=3&action=UPDATE');
    let api!: ReturnType<typeof useUrlFilters>;
    render(<Harness onApi={(a) => (api = a)} />);
    expect(api.page).toBe(3);
    expect(api.values.action).toBe('UPDATE');
    api.setPage(4);
    expect(routerMock.replace).toHaveBeenLastCalledWith('/audit-logs?page=4&action=UPDATE', { scroll: false });
  });

  it('resets to page 1 when a filter changes', () => {
    setMockNavigation('/audit-logs', 'page=3&action=UPDATE');
    let api!: ReturnType<typeof useUrlFilters>;
    render(<Harness onApi={(a) => (api = a)} />);
    api.setFilters({ vendorId: 'v1' });
    const url = routerMock.replace.mock.calls.at(-1)?.[0] as string;
    expect(url).not.toContain('page=');
    expect(url).toContain('vendorId=v1');
    expect(url).toContain('action=UPDATE');
  });

  it('clear removes everything', () => {
    setMockNavigation('/audit-logs', 'page=3&action=UPDATE');
    let api!: ReturnType<typeof useUrlFilters>;
    render(<Harness onApi={(a) => (api = a)} />);
    api.clear();
    expect(routerMock.replace).toHaveBeenLastCalledWith('/audit-logs', { scroll: false });
  });
});

const row: AuditRow = {
  id: 'a1',
  createdAt: '2026-01-01T00:00:00Z',
  vendorId: 'v1',
  vendorName: 'Aqua One',
  userId: 'u1',
  userName: 'Super',
  action: 'UPDATE',
  entity: 'Vendor',
  entityId: 'e1',
  changes: { before: { isActive: true }, after: { isActive: false }, reason: 'non-payment' },
};

describe('AuditDetailDrawer', () => {
  it('renders the diff and the reason', () => {
    render(<AuditDetailDrawer row={row} onClose={jest.fn()} />);
    expect(screen.getByText('isActive')).toBeTruthy();
    expect(screen.getByTestId('diff-before').textContent).toContain('true');
    expect(screen.getByTestId('diff-after').textContent).toContain('false');
    expect(screen.getByTestId('audit-reason').textContent).toContain('non-payment');
  });

  it('shows "No changes recorded" when changes is null', () => {
    render(<AuditDetailDrawer row={{ ...row, changes: null }} onClose={jest.fn()} />);
    expect(screen.getByText('No changes recorded')).toBeTruthy();
  });

  it('closes on Escape', () => {
    const onClose = jest.fn();
    render(<AuditDetailDrawer row={row} onClose={onClose} />);
    fireEvent.keyDown(screen.getByTestId('audit-drawer'), { key: 'Escape', code: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
