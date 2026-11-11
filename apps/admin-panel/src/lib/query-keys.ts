/**
 * Query-key factory. All keys are `as const`, top-level domain first, so
 * `invalidateQueries({ queryKey: queryKeys.vendors.all })` prefix-matches.
 * Rule: each phase adds ONE new top-level block (alphabetical, own lines) and
 * never edits another phase's block.
 */
export const queryKeys = {
  auth: {
    me: ['auth', 'me'] as const,
  },
  dashboard: {
    all: ['dashboard'] as const,
    platform: ['dashboard', 'platform'] as const,
  },
  vendors: {
    all: ['vendors'] as const,
    list: (p: object) => ['vendors', 'list', p] as const,
    detail: (id: string) => ['vendors', 'detail', id] as const,
    wipePreview: (id: string) => ['vendors', 'wipe-preview', id] as const,
    stats: (id: string) => ['vendors', 'stats', id] as const,
    users: (id: string, p: object) => ['vendors', 'users', id, p] as const,
    readiness: (id: string) => ['vendors', 'readiness', id] as const,
    branding: (id: string) => ['vendors', 'branding', id] as const,
    audit: (id: string, p: object) => ['vendors', 'audit', id, p] as const,
  },
};
