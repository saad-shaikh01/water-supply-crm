import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { AuditLogQueryDto } from './dto/audit-log-query.dto';
import { impersonationContext } from '../impersonation/impersonation.context';
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
  changes?: { before?: any; after?: any; reason?: string; impersonatedBy?: any };
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private prisma: PrismaService) {}

  async log(data: AuditLogData): Promise<void> {
    try {
      // During an impersonated request, stamp every audit row with who is really acting.
      const imp = impersonationContext.getStore();
      if (imp) {
        data = {
          ...data,
          changes: {
            ...(data.changes ?? {}),
            impersonatedBy: { actorId: imp.actorId, actorName: imp.actorName, sessionId: imp.sessionId },
          },
        };
      }
      await this.prisma.auditLog.create({ data });
    } catch (err) {
      this.logger.error('Failed to write audit log', err);
    }
  }

  async findAll(callerVendorId: string | null, query: AuditLogQueryDto) {
    const { page = 1, limit = 20, entity, entities, entityId, userId, action, from, to } = query;

    const where: any = {};
    // SUPER_ADMIN passes null vendorId → no vendor filter (or the vendor chosen via the `vendorId` query)
    if (callerVendorId) where.vendorId = callerVendorId;
    if (entity) where.entity = entity;
    else if (entities) {
      const list = entities.split(',').map((e) => e.trim()).filter(Boolean);
      if (list.length) where.entity = { in: list };
    }
    if (entityId) where.entityId = entityId;
    if (userId) where.userId = userId;
    if (action) where.action = action;
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }

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

  /** `callerVendorId` null = platform SUPER_ADMIN (any vendor); otherwise only that vendor's rows. */
  async findOne(id: string, callerVendorId: string | null) {
    return this.prisma.auditLog.findFirst({
      where: { id, ...(callerVendorId ? { vendorId: callerVendorId } : {}) },
    });
  }
}
