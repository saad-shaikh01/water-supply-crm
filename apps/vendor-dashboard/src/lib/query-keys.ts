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
    all: ['products'] as const,
    one: (id: string) => ['products', id] as const,
  },
  routes: {
    all: ['routes'] as const,
    one: (id: string) => ['routes', id] as const,
  },
  vans: {
    all: ['vans'] as const,
    one: (id: string) => ['vans', id] as const,
  },
  users: {
    all: ['users'] as const,
  },
  sheets: {
    all: (params: object) => ['sheets', params] as const,
    one: (id: string) => ['sheets', id] as const,
  },
  transactions: {
    all: (params: object) => ['transactions', params] as const,
  },
};
