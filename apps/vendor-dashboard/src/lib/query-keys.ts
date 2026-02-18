export const queryKeys = {
  auth: {
    me: ['auth', 'me'] as const,
  },
  dashboard: {
    overview: ['dashboard', 'overview'] as const,
    daily: (date: string) => ['dashboard', 'daily', date] as const,
  },
  customers: {
    all: (params: object) => ['customers', params] as const,
    one: (id: string) => ['customers', id] as const,
  },
  products: {
    all: (params?: object) => ['products', params].filter(Boolean) as const,
    one: (id: string) => ['products', id] as const,
  },
  routes: {
    all: (params?: object) => ['routes', params].filter(Boolean) as const,
    one: (id: string) => ['routes', id] as const,
  },
  vans: {
    all: (params?: object) => ['vans', params].filter(Boolean) as const,
    one: (id: string) => ['vans', id] as const,
  },
  users: {
    all: (params?: object) => ['users', params].filter(Boolean) as const,
  },
  sheets: {
    all: (params: object) => ['sheets', params] as const,
    one: (id: string) => ['sheets', id] as const,
  },
  transactions: {
    all: (params: object) => ['transactions', params] as const,
  },
};
