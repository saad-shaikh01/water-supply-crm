/** Deterministic API fixtures for the Phase 3 observability specs. */

export const VENDOR_A = { id: '11111111-1111-4111-8111-111111111111', name: 'Aqua One' };
export const VENDOR_B = { id: '22222222-2222-4222-8222-222222222222', name: 'Blue Co' };

export const vendorsList = { data: [VENDOR_A, VENDOR_B], meta: { total: 2, page: 1, limit: 100, totalPages: 1 } };

const auditRow = (n: number, over: Record<string, unknown> = {}) => ({
  id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`,
  createdAt: `2026-11-0${(n % 9) + 1}T10:00:00.000Z`,
  vendorId: VENDOR_A.id,
  vendorName: VENDOR_A.name,
  userId: '33333333-3333-4333-8333-333333333333',
  userName: 'Super Admin',
  action: 'UPDATE',
  entity: 'Vendor',
  entityId: `entity-${n}`,
  changes: null,
  ...over,
});

export const auditRows = [
  auditRow(1, {
    action: 'SUSPEND',
    changes: { before: { isActive: true, name: 'Aqua One' }, after: { isActive: false, name: 'Aqua One' }, reason: 'non-payment' },
  }),
  auditRow(2, { action: 'CREATE', entity: 'Customer', changes: { after: { name: 'Zed', phone: '0300' } } }),
  auditRow(3, { action: 'LOGIN', entity: 'User', changes: null }),
];

export const auditPage = (page: number) => ({
  data: auditRows,
  meta: { total: 45, page, limit: 20, totalPages: 3 },
});

export const auditFacets = { actions: ['CREATE', 'SUSPEND', 'UPDATE', 'LOGIN'], entities: ['Customer', 'User', 'Vendor'] };

export const CSV_BODY = '﻿createdAt,vendorId,vendorName,userId,userName,action,entity,entityId,changes\r\n2026-11-01T10:00:00.000Z,v,Aqua One,u,Super,SUSPEND,Vendor,e1,\r\n';

const QUEUE_NAMES = [
  'notification', 'whatsapp', 'vendor-import', 'payment-reminder', 'tracking', 'reports',
  'billing', 'sms', 'email', 'sync', 'cleanup', 'webhooks',
];

export const healthOk = (over: Record<string, unknown> = {}) => ({
  generatedAt: new Date().toISOString(),
  cached: false,
  api: { status: 'up', version: '1.2.3', gitSha: 'abcdef1234', nodeEnv: 'production', uptimeSeconds: 7200, startedAt: '2026-11-01T00:00:00.000Z', memory: { rssMb: 210.5, heapUsedMb: 90.1 } },
  database: { status: 'up', latencyMs: 4 },
  redis: { status: 'up', latencyMs: 2, usedMemoryMb: 12, maxmemoryPolicy: 'noeviction', policyOk: true },
  queues: QUEUE_NAMES.map((name, i) => ({
    name,
    status: 'ok',
    paused: false,
    counts: { waiting: i, active: 0, delayed: 0, failed: name === 'whatsapp' ? 3 : 0, completed: 10 },
  })),
  crons: [
    { jobId: 'daily-summary', queue: 'tracking', label: 'Tracking summary', pattern: '0 1 * * *', tz: 'Asia/Karachi', registered: true, nextRunAt: new Date(Date.now() + 3600_000).toISOString(), lastRun: { status: 'completed', finishedAt: new Date(Date.now() - 3600_000).toISOString(), durationMs: 900, failedReason: null } },
  ],
  whatsapp: { enabled: true, accountsTotal: 2, accountsInvalid: 0 },
  ...over,
});

export const failedJobs = {
  queue: 'whatsapp',
  jobs: [
    { id: '41', name: 'send-template', attemptsMade: 3, failedReason: 'Template rejected by Meta', timestamp: 1_760_000_000_000, finishedOn: 1_760_000_100_000 },
  ],
};

export const waAccounts = () => [
  {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001', label: 'Main line', wabaId: 'w1', phoneNumberId: 'p1', displayNumber: '+92 300 1111111',
    verifiedName: 'Aqua Verified', status: 'READY', qualityRating: 'GREEN', lastHealthCheckAt: '2026-11-10T10:00:00.000Z', lastHealthError: null,
    hasToken: true, templateSuffix: null, templatesSyncedAt: null, vendors: [{ id: VENDOR_A.id, name: VENDOR_A.name, isActive: true }],
  },
  {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000002', label: 'Spare line', wabaId: 'w2', phoneNumberId: 'p2', displayNumber: null,
    verifiedName: null, status: 'TOKEN_INVALID', qualityRating: null, lastHealthCheckAt: '2026-11-10T09:00:00.000Z', lastHealthError: 'Token expired',
    hasToken: true, templateSuffix: null, templatesSyncedAt: null, vendors: [],
  },
];

export const importRow = (n: number, status: string, over: Record<string, unknown> = {}) => ({
  id: `cccccccc-cccc-4ccc-8ccc-${String(n).padStart(12, '0')}`,
  vendorId: VENDOR_A.id, vendorName: VENDOR_A.name, entity: 'CUSTOMERS_OPENING', status,
  sourceFileName: 'customers.xlsx', sourceFileSize: 20480, rowCount: 120, summary: { 'plan.create': 100 },
  errorCode: null, errorMessage: null, createdByName: 'Super Admin', startedAt: null, completedAt: null, createdAt: '2026-11-10T08:00:00.000Z', jobId: null,
  ...over,
});
