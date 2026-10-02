import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { AuditLogQueryDto } from './dto/audit-log-query.dto';
import { paginate } from '../../common/helpers/paginate';

export interface AuditLogData {
  vendorId?: string;
  userId?: string;
  userName?: string;
  action: string;
  entity: string;
  entityId?: string;
  /**
   * `reason` (P2 convention) is the mandatory human reason captured for edits /
   * voids / adjustments; the history view reads it from here first, falling back
   * to legacy `after.voidReason` / `adjustmentReason` / `correctionReason`.
   */
  changes?: { before?: any; after?: any; reason?: string };
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private prisma: PrismaService) {}

  async log(data: AuditLogData): Promise<void> {
    try {
      await this.prisma.auditLog.create({ data });
    } catch (err) {
      this.logger.error('Failed to write audit log', err);
    }
  }

  async findAll(callerVendorId: string | null, query: AuditLogQueryDto) {
    const { page = 1, limit = 20, entity, entityId, userId, action, customerId, search, from, to } = query;

    const where: any = {};
    const and: any[] = [];
    // SUPER_ADMIN passes null vendorId → no vendor filter
    if (callerVendorId) where.vendorId = callerVendorId;
    if (entity) where.entity = entity;
    if (entityId) where.entityId = entityId;
    if (userId) where.userId = userId;
    if (action) where.action = action;
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }

    if (customerId) {
      and.push({
        OR: [
          { entity: 'Customer', entityId: customerId },
          { changes: { path: ['after', 'customerId'], equals: customerId } },
          { changes: { path: ['before', 'customerId'], equals: customerId } },
          { changes: { path: ['after', 'customerIds'], array_contains: [customerId] } },
        ],
      });
    }

    const term = search?.trim();
    if (term) {
      and.push({
        OR: [
          { userName: { contains: term, mode: 'insensitive' } },
          { action: { contains: term, mode: 'insensitive' } },
          { entity: { contains: term, mode: 'insensitive' } },
          { entityId: { contains: term, mode: 'insensitive' } },
        ],
      });
    }
    if (and.length) where.AND = and;

    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return paginate(data, total, page, limit);
  }

  /** Distinct values that actually exist, so the filter dropdowns never go stale. */
  async getFilterOptions(callerVendorId: string | null) {
    const where = callerVendorId ? { vendorId: callerVendorId } : {};
    const [entities, actions, users] = await Promise.all([
      this.prisma.auditLog.groupBy({ by: ['entity'], where, orderBy: { entity: 'asc' } }),
      this.prisma.auditLog.groupBy({ by: ['action'], where, orderBy: { action: 'asc' } }),
      this.prisma.auditLog.groupBy({
        by: ['userId', 'userName'],
        where: { ...where, userId: { not: null } },
        orderBy: { userName: 'asc' },
      }),
    ]);

    return {
      entities: entities.map((e) => e.entity),
      actions: actions.map((a) => a.action),
      users: users.map((u) => ({ id: u.userId as string, name: u.userName ?? 'Unknown' })),
    };
  }

  async findOne(id: string) {
    return this.prisma.auditLog.findUnique({ where: { id } });
  }
}
