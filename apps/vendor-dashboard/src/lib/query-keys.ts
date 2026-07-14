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
  warehouse: {
    stock: (vendorId?: string) => ['warehouse', 'stock', ...(vendorId ? [vendorId] : [])] as const,
    universe: () => ['warehouse', 'universe'] as const,
    transactions: (params: object) => ['warehouse', 'transactions', params] as const,
    repairs: (params: object) => ['warehouse', 'repairs', params] as const,
    summary: (params: object) => ['warehouse', 'summary', params] as const,
  },
  // Customer Communication Center (docs/features/customer-communication-center.md).
  communication: {
    forItem: (itemId: string) => ['conversation', 'for-item', itemId] as const,
    messages: (conversationId: string) => ['conversation-messages', conversationId] as const,
    inbox: (params: object) => ['conversations', params] as const,
  },
};
