import { fireEvent, render, screen } from '@testing-library/react';
import { StatsStrip } from './stats-strip';
import { ImportsTable } from './imports-table';
import { importsRefetchInterval, IMPORTS_POLL_MS } from '../hooks/use-imports';
import type { ImportRow, ImportsResponse } from '../api/imports.api';

const row = (status: string): ImportRow => ({
  id: status, vendorId: 'v', vendorName: 'Aqua One', entity: 'CUSTOMERS_OPENING', status, sourceFileName: 'a.xlsx', sourceFileSize: 2048,
  rowCount: 10, summary: null, errorCode: null, errorMessage: status === 'FAILED' ? 'boom' : null, createdByName: null,
  startedAt: null, completedAt: null, createdAt: '2026-01-01T00:00:00Z',
});
const pagination = { page: 1, limit: 20, total: 2, onPageChange: jest.fn(), onLimitChange: jest.fn() };
const resp = (...s: string[]): ImportsResponse => ({ data: s.map(row), meta: { total: s.length, page: 1, limit: 20, totalPages: 1 } });

describe('StatsStrip', () => {
  it('highlights stuck > 0 in red', () => {
    render(<StatsStrip stats={{ last7d: { COMPLETED: 4 }, stuck: 2 }} />);
    expect(screen.getByTestId('imports-stuck').getAttribute('data-stuck')).toBe('2');
    expect(screen.getByTestId('imports-stuck').className).toContain('red');
  });
  it('is neutral at 0', () => {
    render(<StatsStrip stats={{ last7d: {}, stuck: 0 }} />);
    expect(screen.getByTestId('imports-stuck').className).not.toContain('red');
  });
});

describe('ImportsTable', () => {
  it('renders rows, selects on click, exposes no download link', () => {
    const onSelect = jest.fn();
    const { container } = render(<ImportsTable rows={[row('FAILED'), row('COMPLETED')]} onSelect={onSelect} pagination={pagination} />);
    expect(screen.getByText('boom')).toBeTruthy();
    expect(container.querySelector('a[href]')).toBeNull();
    fireEvent.click(screen.getAllByLabelText(/View import/)[0]);
    expect(onSelect).toHaveBeenCalled();
  });
});

describe('imports auto-refresh', () => {
  it('polls every 15s only while a row is active', () => {
    expect(importsRefetchInterval(resp('COMPLETED'))).toBe(false);
    expect(importsRefetchInterval(resp('COMPLETED', 'EXECUTING'))).toBe(IMPORTS_POLL_MS);
    expect(importsRefetchInterval(undefined)).toBe(false);
  });
});
