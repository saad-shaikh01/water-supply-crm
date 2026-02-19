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
    all: (params?: object) => ['products', ...(params ? [params] : [])],
    one: (id: string) => ['products', id] as const,
  },
  routes: {
    all: (params?: object) => ['routes', ...(params ? [params] : [])],
    one: (id: string) => ['routes', id] as const,
  },
  vans: {
    all: (params?: object) => ['vans', ...(params ? [params] : [])],
    one: (id: string) => ['vans', id] as const,
  },
  users: {
    all: (params?: object) => ['users', ...(params ? [params] : [])],
  },
  sheets: {
    all: (params: object) => ['sheets', params] as const,
    one: (id: string) => ['sheets', id] as const,
  },
  transactions: {
    all: (params: object) => ['transactions', params] as const,
  },
};
