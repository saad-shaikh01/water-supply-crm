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
    access: (id: string) => ['users', id, 'access'] as const,
  },
  roles: {
    all: () => ['roles'] as const,
    one: (id: string) => ['roles', id] as const,
  },
  permissions: {
    catalog: () => ['permissions', 'catalog'] as const,
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
  // Crew Cash Distribution (docs/features/crew-operational-cash-distribution.md).
  crewCash: {
    forSheet: (sheetId: string) => ['crew-cash', 'for-sheet', sheetId] as const,
  },
  // Customer Communication Center (docs/features/customer-communication-center.md).
  communication: {
    forItem: (itemId: string) => ['conversation', 'for-item', itemId] as const,
    messages: (conversationId: string) => ['conversation-messages', conversationId] as const,
    inbox: (params: object) => ['conversations', params] as const,
  },
  // Payroll (docs/features/staff-payroll-financial-management.md).
  payroll: {
    eligibleEmployees: () => ['payroll', 'eligible-employees'] as const,
    openPeriod: () => ['payroll', 'open-period'] as const,
    periodEntries: (periodId: string) => ['payroll', 'period-entries', periodId] as const,
    pendingLedgerCount: () => ['payroll', 'pending-ledger-count'] as const,
    salaryHistory: (userId: string) => ['payroll', 'salary-history', userId] as const,
    effectiveSalary: (userId: string) => ['payroll', 'effective-salary', userId] as const,
    unsettledLedger: (userId: string) => ['payroll', 'unsettled-ledger', userId] as const,
    ledgerTimeline: (userId: string, params: object) => ['payroll', 'ledger-timeline', userId, params] as const,
  },
};
