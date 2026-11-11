import { apiClient, unwrap } from '../../../lib/api';

export type ServiceStatus = 'up' | 'down' | 'unknown';

export interface ApiInfo {
  status: ServiceStatus;
  version: string;
  gitSha: string | null;
  nodeEnv: string;
  uptimeSeconds: number;
  startedAt: string;
  memory: { rssMb: number; heapUsedMb: number };
}

export interface QueueCounts {
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  completed: number;
}

export interface QueueHealth {
  name: string;
  status: 'ok' | 'unknown';
  paused: boolean | null;
  counts: QueueCounts | null;
}

export interface CronLastRun {
  status: 'completed' | 'failed';
  finishedAt: string | null;
  durationMs: number | null;
  failedReason: string | null;
}

export interface CronHealth {
  jobId: string;
  queue: string;
  label: string;
  pattern: string | null;
  tz: string | null;
  registered: boolean | null;
  nextRunAt: string | null;
  lastRun: CronLastRun | null;
  status?: 'ok' | 'unknown';
}

export interface SystemHealth {
  generatedAt: string;
  cached: boolean;
  api?: ApiInfo;
  database?: { status: ServiceStatus; latencyMs: number | null };
  redis?: {
    status: ServiceStatus;
    latencyMs: number | null;
    usedMemoryMb: number | null;
    maxmemoryPolicy: string | null;
    policyOk: boolean | null;
  };
  queues?: QueueHealth[];
  crons?: CronHealth[];
  whatsapp?: { enabled: boolean; accountsTotal: number; accountsInvalid: number } | null;
}

export interface FailedJob {
  id: string | null;
  name: string;
  attemptsMade: number;
  failedReason: string | null;
  timestamp: number | null;
  finishedOn: number | null;
}

export interface FailedJobsResponse {
  queue: string;
  jobs: FailedJob[];
}

export const healthApi = {
  get: (refresh = false) =>
    unwrap(apiClient.get<SystemHealth>('/platform/health', { params: refresh ? { refresh: 'true' } : undefined })),
  failedJobs: (queue: string, limit = 10) =>
    unwrap(apiClient.get<FailedJobsResponse>(`/platform/health/queues/${encodeURIComponent(queue)}/failed`, { params: { limit } })),
};
