export const CACHE_KEYS = {
  PRODUCTS: 'products',
  ROUTES: 'routes',
  CUSTOMERS: 'customers',
  WALLETS: 'wallets',
  USERS: 'users',
  VANS: 'vans',
  DASHBOARD: 'dashboard',
} as const;

export const CACHE_TTLS = {
  PRODUCTS: 300000, // 5 minutes
  ROUTES: 300000, // 5 minutes
  CUSTOMERS: 120000, // 2 minutes
  WALLETS: 30000, // 30 seconds
  USERS: 300000, // 5 minutes
  VANS: 300000, // 5 minutes
  DASHBOARD: 60000, // 1 minute
} as const;
