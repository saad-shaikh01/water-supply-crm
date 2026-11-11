import { render, screen } from '@testing-library/react';
import { navigationMockFactory, setMockNavigation } from '../../../test/mocks/next-navigation';
import { Sidebar } from './sidebar';
import { useAuthStore } from '../../store/auth.store';

jest.mock('next/navigation', () => navigationMockFactory());

describe('Sidebar', () => {
  beforeEach(() => useAuthStore.setState({ user: null }));

  it('renders one link per registry item in order, no products link', () => {
    setMockNavigation('/');
    render(<Sidebar />);
    const links = screen.getAllByRole('link').filter((l) => l.textContent !== 'WaterCRM');
    expect(links.map((l) => l.textContent)).toEqual(['Overview', 'Vendors', 'Audit Logs', 'System Health', 'Imports', 'WhatsApp', 'Platform Admins', 'Security', 'Settings']);
    expect(links.map((l) => l.getAttribute('href'))).toEqual(['/', '/vendors', '/audit-logs', '/system-health', '/imports', '/whatsapp', '/settings/admins', '/settings/security', '/settings']);
    expect(screen.queryByText(/products/i)).toBeNull();
  });

  it('highlights Overview only on exact /', () => {
    setMockNavigation('/vendors');
    render(<Sidebar />);
    expect(screen.getByText('Overview').closest('a')?.getAttribute('aria-current')).toBeNull();
    expect(screen.getByText('Vendors').closest('a')?.getAttribute('aria-current')).toBe('page');
  });

  it('highlights Vendors on a nested path', () => {
    setMockNavigation('/vendors/123');
    render(<Sidebar />);
    expect(screen.getByText('Vendors').closest('a')?.getAttribute('aria-current')).toBe('page');
  });

  it('shows the signed-in user in the footer', () => {
    setMockNavigation('/');
    useAuthStore.setState({ user: { id: '1', name: 'Sam Admin', email: 's@x.com', role: 'SUPER_ADMIN' } });
    render(<Sidebar />);
    expect(screen.getByText('Sam Admin')).toBeTruthy();
    expect(screen.getByText('SUPER ADMIN')).toBeTruthy();
  });
});
