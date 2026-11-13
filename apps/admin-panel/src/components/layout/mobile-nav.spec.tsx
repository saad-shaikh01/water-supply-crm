import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { navigationMockFactory, setMockNavigation } from '../../../test/mocks/next-navigation';
import { Sidebar, MobileNav } from './sidebar';
import { Header } from './header';

jest.mock('next/navigation', () => navigationMockFactory());
jest.mock('./user-nav', () => ({ UserNav: () => <div /> }));
jest.mock('./theme-toggle', () => ({ ThemeToggle: () => <div /> }));
jest.mock('../../features/settings/components/maintenance-banner', () => ({ MaintenanceBanner: () => null }));

function Shell() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Sidebar />
      <MobileNav open={open} onOpenChange={setOpen} />
      <Header onMenuClick={() => setOpen(true)} menuOpen={open} />
    </>
  );
}

describe('responsive shell', () => {
  beforeEach(() => setMockNavigation('/'));

  it('desktop aside is lg-only and the drawer is closed by default', () => {
    render(<Shell />);
    expect(document.querySelector('aside')?.className).toMatch(/hidden lg:flex/);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('hamburger has an accessible name and opens the drawer', async () => {
    render(<Shell />);
    const btn = screen.getByRole('button', { name: 'Open navigation menu' });
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(btn.className).toMatch(/lg:hidden/);
    fireEvent.click(btn);
    const dialog = await screen.findByRole('dialog');
    expect(dialog.getAttribute('aria-labelledby')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open navigation menu', hidden: true }).getAttribute('aria-expanded')).toBe('true');
    expect(dialog.querySelectorAll('nav a').length).toBe(11);
  });

  it('Esc closes the drawer', async () => {
    render(<Shell />);
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }));
    await screen.findByRole('dialog');
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('close button closes the drawer', async () => {
    render(<Shell />);
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('clicking a nav link closes the drawer', async () => {
    render(<Shell />);
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }));
    const dialog = await screen.findByRole('dialog');
    const link = Array.from(dialog.querySelectorAll('a')).find((a) => a.textContent === 'Vendors') as HTMLElement;
    fireEvent.click(link);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('route change closes the drawer', async () => {
    const { rerender } = render(<Shell />);
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }));
    await screen.findByRole('dialog');
    setMockNavigation('/audit-logs');
    rerender(<Shell />);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
