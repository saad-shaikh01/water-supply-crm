export const queryKeys = {
  auth:      { me: ['auth', 'me'] },
  dashboard: { overview: ['dashboard', 'overview'] },
  vendors:   { all: (p: object) => ['vendors', p], one: (id: string) => ['vendors', id] },
};
