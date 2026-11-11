/**
 * Query-key factory. All keys are `as const`, top-level domain first, so
 * `invalidateQueries({ queryKey: queryKeys.vendors.all })` prefix-matches.
 * Rule: each phase adds ONE new top-level block (alphabetical, own lines) and
 * never edits another phase's block.
 */
export const queryKeys = {
  audit: {
    all: ['audit'] as const,
    list: (p: object) => ['audit', 'list', p] as const,
    facets: ['audit', 'facets'] as const,
  },
  auth: {
    me: ['auth', 'me'] as const,
  },
  dashboard: {
    all: ['dashboard'] as const,
    platform: ['dashboard', 'platform'] as const,
  },
  health: {
    all: ['health'] as const,
    overview: ['health', 'overview'] as const,
    failedJobs: (queue: string) => ['health', 'failed', queue] as const,
  },
  imports: {
    all: ['imports'] as const,
    list: (p: object) => ['imports', 'list', p] as const,
    stats: ['imports', 'stats'] as const,
    detail: (id: string) => ['imports', 'detail', id] as const,
  },
  vendors: {
    all: ['vendors'] as const,
    list: (p: object) => ['vendors', 'list', p] as const,
    detail: (id: string) => ['vendors', 'detail', id] as const,
    wipePreview: (id: string) => ['vendors', 'wipe-preview', id] as const,
  },
  whatsappAccounts: {
    all: ['whatsapp-accounts'] as const,
    list: (p: object) => ['whatsapp-accounts', 'list', p] as const,
    assignable: (q: string) => ['whatsapp-accounts', 'assignable', q] as const,
  },
};
