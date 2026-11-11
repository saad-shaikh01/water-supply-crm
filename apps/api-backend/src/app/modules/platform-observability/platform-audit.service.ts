import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { paginate } from '../../common/helpers/paginate';
import { PlatformAuditQueryDto } from './dto/platform-audit-query.dto';
import { redactSensitive } from './redact.util';
import { csvRow } from './csv.util';

export const EXPORT_ROW_CAP = 50_000;
export const EXPORT_MAX_RANGE_DAYS = 366;
export const EXPORT_DEFAULT_WINDOW_DAYS = 30;
const FACETS_TTL_MS = 5 * 60 * 1000;
const BATCH = 1000;
export const CSV_HEADER = ['createdAt', 'vendorId', 'vendorName', 'userId', 'userName', 'action', 'entity', 'entityId', 'changes'];

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

@Injectable()
export class PlatformAuditService {
  private facetsCache: { at: number; value: { actions: string[]; entities: string[] } } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /** from: date-only => start of day UTC; to: date-only => end of that day (inclusive). */
  buildWhere(q: PlatformAuditQueryDto, opts: { defaultFromDays?: number } = {}) {
    const where: Record<string, any> = {};
    if (q.vendorId) where.vendorId = q.vendorId;
    if (q.userId) where.userId = q.userId;
    if (q.action) where.action = q.action;
    if (q.entity) where.entity = q.entity;
    if (q.entityId) where.entityId = q.entityId;
    if (q.q) where.userName = { contains: q.q, mode: 'insensitive' };

    let from = q.from ? new Date(q.from) : undefined;
    let to: Date | undefined;
    if (q.to) {
      to = new Date(q.to);
      if (DATE_ONLY.test(q.to)) to = new Date(to.getTime() + 24 * 3600 * 1000 - 1);
    }
    if ((from && isNaN(from.getTime())) || (to && isNaN(to.getTime()))) throw new BadRequestException('Invalid date');
    if (from && to && from > to) throw new BadRequestException('"from" must not be after "to"');
    if (!from && opts.defaultFromDays) from = new Date(Date.now() - opts.defaultFromDays * 24 * 3600 * 1000);
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = from;
      if (to) where.createdAt.lte = to;
    }
    return { where, from, to };
  }

  private async vendorNames(rows: Array<{ vendorId: string | null }>): Promise<Map<string, string>> {
    const ids = [...new Set(rows.map((r) => r.vendorId).filter((v): v is string => !!v))];
    if (!ids.length) return new Map();
    const vendors = await this.prisma.vendor.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
    return new Map(vendors.map((v) => [v.id, v.name]));
  }

  private toRow(r: any, names: Map<string, string>) {
    return {
      id: r.id,
      createdAt: r.createdAt,
      vendorId: r.vendorId ?? null,
      vendorName: r.vendorId ? (names.get(r.vendorId) ?? null) : null,
      userId: r.userId ?? null,
      userName: r.userName ?? null,
      action: r.action,
      entity: r.entity,
      entityId: r.entityId ?? null,
      changes: redactSensitive(r.changes ?? null),
    };
  }

  async findAll(q: PlatformAuditQueryDto) {
    const { page = 1, limit = 20 } = q;
    const { where } = this.buildWhere(q);
    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * limit, take: limit }),
      this.prisma.auditLog.count({ where }),
    ]);
    const names = await this.vendorNames(rows);
    return paginate(rows.map((r) => this.toRow(r, names)), total, page, limit);
  }

  async findOne(id: string) {
    const r = await this.prisma.auditLog.findUnique({ where: { id } });
    if (!r) return null;
    return this.toRow(r, await this.vendorNames([r]));
  }

  async facets() {
    if (this.facetsCache && Date.now() - this.facetsCache.at < FACETS_TTL_MS) return this.facetsCache.value;
    const [actions, entities] = await Promise.all([
      this.prisma.auditLog.groupBy({ by: ['action'], orderBy: { action: 'asc' } }),
      this.prisma.auditLog.groupBy({ by: ['entity'], orderBy: { entity: 'asc' } }),
    ]);
    const value = { actions: actions.map((a) => a.action), entities: entities.map((e) => e.entity) };
    this.facetsCache = { at: Date.now(), value };
    return value;
  }

  /** Validate an export request and report whether the cap will truncate it. */
  async prepareExport(q: PlatformAuditQueryDto) {
    const { where, from, to } = this.buildWhere(q, { defaultFromDays: EXPORT_DEFAULT_WINDOW_DAYS });
    const end = to ?? new Date();
    if (from && (end.getTime() - from.getTime()) / 86_400_000 > EXPORT_MAX_RANGE_DAYS) {
      throw new BadRequestException(`Export range must not exceed ${EXPORT_MAX_RANGE_DAYS} days`);
    }
    const total = await this.prisma.auditLog.count({ where });
    return { where, total, truncated: total > EXPORT_ROW_CAP };
  }

  /** Yields CSV text chunks (header first), batched by cursor; stops at the cap. */
  async *exportChunks(where: Record<string, any>, counter: { rows: number }): AsyncGenerator<string> {
    yield '﻿' + csvRow(CSV_HEADER);
    let cursor: string | undefined;
    while (counter.rows < EXPORT_ROW_CAP) {
      const take = Math.min(BATCH, EXPORT_ROW_CAP - counter.rows);
      const rows = await this.prisma.auditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (!rows.length) break;
      const names = await this.vendorNames(rows);
      let chunk = '';
      for (const r of rows) {
        const x = this.toRow(r, names);
        chunk += csvRow([x.createdAt, x.vendorId, x.vendorName, x.userId, x.userName, x.action, x.entity, x.entityId, x.changes === null ? '' : JSON.stringify(x.changes)]);
      }
      counter.rows += rows.length;
      yield chunk;
      if (rows.length < take) break;
      cursor = rows[rows.length - 1].id;
    }
  }
}
