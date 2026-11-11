import { screen } from '@testing-library/react';
import { apiClient } from '@water-supply-crm/data-access';
import DashboardPage from '../src/app/(dashboard)/page';
import { renderWithQuery, fullPlatformPayload } from '../test/utils/render';

jest.mock('@water-supply-crm/data-access', () => ({ apiClient: { get: jest.fn() } }));

describe('admin-panel smoke', () => {
  it('renders the Platform Overview page with data', async () => {
    (apiClient.get as jest.Mock).mockResolvedValue({ data: fullPlatformPayload });
    renderWithQuery(<DashboardPage />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Platform Overview');
    await screen.findByTestId('kpi-vendors-total');
  });
});
