export const queryKeys = {
  auth: {
    me: ['auth', 'me'] as const,
  },
  customer: {
    profile: (id: string) => ['customer', id, 'profile'] as const,
  },
  transactions: {
    all: (customerId: string, params: object) =>
      ['transactions', customerId, params] as const,
    summary: (customerId: string) =>
      ['transactions', customerId, 'summary'] as const,
  },
};
