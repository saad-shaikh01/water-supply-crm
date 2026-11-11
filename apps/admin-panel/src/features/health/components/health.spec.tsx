import { fireEvent, render, screen } from '@testing-library/react';
import { QueueTable } from './queue-table';
import { CronTable } from './cron-table';
import { overallStatus } from './service-status-cards';
import { healthRefetchInterval, HEALTH_POLL_MS } from '../hooks/use-system-health';
import type { CronHealth, QueueHealth, SystemHealth } from '../api/health.api';

const q = (name: string, failed: number, extra: Partial<QueueHealth> = {}): QueueHealth => ({
  name,
  status: 'ok',
  paused: false,
  counts: { waiting: 1, active: 0, delayed: 0, failed, completed: 5 },
  ...extra,
});

describe('QueueTable', () => {
  it('flags failed>0 rows and opens the drill-down on click', () => {
    const onSelect = jest.fn();
    render(<QueueTable queues={[q('a', 0), q('b', 3)]} onSelectFailed={onSelect} />);
    const rows = screen.getAllByTestId('queue-row');
    expect(rows[0].getAttribute('data-failed')).toBe('false');
    expect(rows[1].getAttribute('data-failed')).toBe('true');
    fireEvent.click(screen.getByLabelText('View 3 failed jobs in b'));
    expect(onSelect).toHaveBeenCalledWith('b');
    expect(screen.queryByLabelText(/View 0 failed/)).toBeNull();
  });

  it('renders a placeholder for unknown queues', () => {
    render(<QueueTable queues={[q('x', 0, { status: 'unknown', counts: null, paused: null })]} onSelectFailed={jest.fn()} />);
    expect(screen.getByText('Unavailable')).toBeTruthy();
  });
});

const cron = (over: Partial<CronHealth>): CronHealth => ({
  jobId: 'j', queue: 'q', label: 'Daily job', pattern: '0 5 * * *', tz: 'UTC', registered: true, nextRunAt: null, lastRun: null, ...over,
});

describe('CronTable', () => {
  it('warns when not registered', () => {
    render(<CronTable crons={[cron({ registered: false })]} />);
    expect(screen.getByTestId('cron-not-registered')).toBeTruthy();
  });
  it('shows failed badge and "No history"', () => {
    render(
      <CronTable
        crons={[
          cron({ jobId: '1', lastRun: { status: 'failed', finishedAt: '2026-01-01T00:00:00Z', durationMs: 5, failedReason: 'boom' } }),
          cron({ jobId: '2', lastRun: null }),
        ]}
      />,
    );
    expect(screen.getByText('failed')).toBeTruthy();
    expect(screen.getByText('boom')).toBeTruthy();
    expect(screen.getByText('No history')).toBeTruthy();
    expect(screen.getAllByText('Daily at 05:00')).toHaveLength(2);
  });
});

describe('overallStatus', () => {
  const base: SystemHealth = {
    generatedAt: '', cached: false,
    database: { status: 'up', latencyMs: 1 },
    redis: { status: 'up', latencyMs: 1, usedMemoryMb: 1, maxmemoryPolicy: 'noeviction', policyOk: true },
    queues: [q('a', 0)], crons: [],
  };
  it('healthy / degraded / down', () => {
    expect(overallStatus(base)).toBe('healthy');
    expect(overallStatus({ ...base, redis: { ...base.redis!, status: 'down' } })).toBe('degraded');
    expect(overallStatus({ ...base, database: { status: 'down', latencyMs: null } })).toBe('down');
  });
});

describe('health polling', () => {
  const setHidden = (v: boolean) => Object.defineProperty(document, 'hidden', { configurable: true, get: () => v });
  afterEach(() => setHidden(false));

  it('polls every 30s while visible and pauses when the tab is hidden', () => {
    setHidden(false);
    expect(healthRefetchInterval()).toBe(HEALTH_POLL_MS);
    setHidden(true);
    expect(healthRefetchInterval()).toBe(false);
  });
});
