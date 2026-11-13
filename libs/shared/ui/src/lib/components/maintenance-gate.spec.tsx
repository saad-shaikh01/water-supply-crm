import { act, render, screen } from '@testing-library/react';
import { MaintenanceGate } from './maintenance-gate';

const fire = (detail: unknown) => act(() => void window.dispatchEvent(new CustomEvent('platform:maintenance', { detail })));

describe('MaintenanceGate', () => {
  it('renders nothing until the maintenance event fires', () => {
    render(<MaintenanceGate />);
    expect(screen.queryByTestId('maintenance-gate')).toBeNull();
  });

  it('shows the message and ETA from the event', () => {
    render(<MaintenanceGate />);
    fire({ message: 'Upgrading the database', eta: '2026-12-01T12:00:00.000Z' });
    const gate = screen.getByTestId('maintenance-gate');
    expect(gate.textContent).toContain('Upgrading the database');
    expect(gate.textContent).toContain('Expected back');
    expect(gate.getAttribute('role')).toBe('alert');
  });

  it('falls back to a default message without eta', () => {
    render(<MaintenanceGate />);
    fire({});
    expect(screen.getByTestId('maintenance-gate').textContent).toContain('scheduled maintenance');
    expect(screen.getByTestId('maintenance-gate').textContent).not.toContain('Expected back');
  });

  it('removes its listener on unmount', () => {
    const { unmount } = render(<MaintenanceGate />);
    unmount();
    fire({ message: 'x' });
    expect(screen.queryByTestId('maintenance-gate')).toBeNull();
  });
});
