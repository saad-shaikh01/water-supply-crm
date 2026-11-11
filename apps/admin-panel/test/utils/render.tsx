import type { ReactElement, ReactNode } from 'react';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
}

export function renderWithQuery(ui: ReactElement, client: QueryClient = createTestQueryClient()) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, ...render(ui, { wrapper }) };
}

export const fullPlatformPayload = {
  vendors: { total: 12, active: 9, suspended: 3, newThisMonth: 2 },
  customers: { total: 1500 },
  drivers: { totalActive: 40 },
  revenue: { allTime: 9876543, thisMonth: 120000, lastMonth: 100000, growthPercent: 20 },
  deliveries: { thisMonth: 777 },
  topVendors: [
    { vendor: { id: 'v1', name: 'Aqua One', slug: 'aqua-one' }, totalRevenue: 50000 },
    { vendor: { id: 'v2', name: 'Blue Co', slug: 'blue-co' }, totalRevenue: 30000 },
  ],
};
