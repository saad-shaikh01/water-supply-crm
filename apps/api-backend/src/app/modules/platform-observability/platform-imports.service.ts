import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { PrismaService } from '@water-supply-crm/database';
import { QUEUE_NAMES } from '@water-supply-crm/queue';
import { paginate } from '../../common/helpers/paginate';
import { PlatformImportsQueryDto } from './dto/platform-imports-query.dto';
import { PLATFORM_QUEUES } from './queue-registry';
import { redactText } from './redact.util';

export const STUCK_AFTER_MS = 30 * 60 * 1000;
export const STUCK_STATUSES = ['QUEUED', 'EXECUTING', 'PLANNING'] as const;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Explicit allow-list: never sourceFileKey / mapping / options / rows. */
const SELECT = {
  id: true,
  vendorId: true,
  entity: true,
  status: true,
  sourceFileName: true,
  sourceFileSize: true,
  rowCount: true,
  summary: true,
  errorCode: true,
  errorMessage: true,
  createdByName: true,
  startedAt: true,
  completedAt: true,
  createdAt: true,
  jobId: true,
  vendor: { select: { name: true } },
} as const;

/** Keep only numeric counters from the plan/final summary JSON. */
function counters(summary: unknown): Record<string, number> | null {
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) return null;
  const out: Record<string, number> = {};
  const walk = (o: Record<string, unknown>, prefix: string, depth: number) => {
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === 'number' && Number.isFinite(v)) out[prefix + k] = v;
      else if (v && typeof v === 'object' && !Array.isArray(v) && depth < 2) walk(v as Record<string, unknown>, `${prefix}${k}.`, depth + 1);
    }
  };
  walk(summary as Record<string, unknown>, '', 0);
  return out;
}

@Injectable()
export class PlatformImportsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PLATFORM_QUEUES) private readonly queues: Map<string, Queue>,
  ) {}

  private toRow(b: any) {
    return {
      id: b.id,
      vendorId: b.vendorId,
      vendorName: b.vendor?.name ?? null,
      entity: b.entity,
      status: b.status,
      sourceFileName: b.sourceFileName,
      sourceFileSize: b.sourceFileSize,
      rowCount: b.rowCount,
      summary: counters(b.summary),
      errorCode: b.errorCode ?? null,
      errorMessage: redactText(b.errorMessage, 500),
      createdByName: b.createdByName ?? null,
      startedAt: b.startedAt ?? null,
      completedAt: b.completedAt ?? null,
      createdAt: b.createdAt,
      jobId: b.jobId ?? null,
    };
  }

  async list(q: PlatformImportsQueryDto) {
    const { page = 1, limit = 20 } = q;
    const where: Record<string, any> = {};
    if (q.vendorId) where.vendorId = q.vendorId;
    if (q.status) where.status = q.status;
    if (q.entity) where.entity = q.entity;
    if (q.from || q.to) {
      const from = q.from ? new Date(q.from) : undefined;
      let to = q.to ? new Date(q.to) : undefined;
      if (to && DATE_ONLY.test(q.to as string)) to = new Date(to.getTime() + 24 * 3600 * 1000 - 1);
      if (from && to && from > to) throw new BadRequestException('"from" must not be after "to"');
      where.createdAt = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
    }
    const [rows, total] = await Promise.all([
      this.prisma.importBatch.findMany({ where, select: SELECT, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * limit, take: limit }),
      this.prisma.importBatch.count({ where }),
    ]);
    return paginate(rows.map((r) => this.toRow(r)), total, page, limit);
  }

  async stats() {
    const now = Date.now();
    const since = new Date(now - 7 * 24 * 3600 * 1000);
    const [groups, stuck] = await Promise.all([
      this.prisma.importBatch.groupBy({ by: ['status'], where: { createdAt: { gte: since } }, _count: { _all: true } }),
      this.prisma.importBatch.count({ where: { status: { in: [...STUCK_STATUSES] }, updatedAt: { lt: new Date(now - STUCK_AFTER_MS) } } }),
    ]);
    const last7d: Record<string, number> = {};
    for (const g of groups) last7d[g.status] = g._count._all;
    return { last7d, stuck };
  }

  async findOne(id: string) {
    const b = await this.prisma.importBatch.findUnique({ where: { id }, select: SELECT });
    if (!b) throw new NotFoundException('Import batch not found');
    return { ...this.toRow(b), queueState: await this.queueState(b.jobId) };
  }

  private async queueState(jobId: string | null) {
    if (!jobId) return null;
    try {
      const q = this.queues.get(QUEUE_NAMES.VENDOR_IMPORT);
      const job = q ? await q.getJob(jobId) : null;
      if (!job) return null;
      return { state: await job.getState(), attemptsMade: job.attemptsMade ?? 0, failedReason: redactText(job.failedReason) };
    } catch {
      return null;
    }
  }
}
