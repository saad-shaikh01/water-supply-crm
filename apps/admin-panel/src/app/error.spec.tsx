import { render, screen, fireEvent } from '@testing-library/react';
import RootError from './error';
import DashboardError from './(dashboard)/error';
import NotFound from './not-found';
import DashboardNotFound from './(dashboard)/not-found';

describe('error boundaries and not-found (E1)', () => {
  beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => undefined));
  afterEach(() => jest.restoreAllMocks());

  it.each([
    ['root', RootError],
    ['dashboard', DashboardError],
  ])('%s boundary shows message and calls reset', (_n, Comp) => {
    const reset = jest.fn();
    render(<Comp error={Object.assign(new Error('boom'), { digest: 'd1' })} reset={reset} />);
    expect(screen.getByRole('alert').textContent).toContain('boom');
    fireEvent.click(screen.getByText('Try again'));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('not-found pages link home', () => {
    const { unmount } = render(<NotFound />);
    expect(screen.getByText('Page not found')).toBeTruthy();
    expect(screen.getByRole('link').getAttribute('href')).toBe('/');
    unmount();
    render(<DashboardNotFound />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('link').getAttribute('href')).toBe('/');
  });
});
