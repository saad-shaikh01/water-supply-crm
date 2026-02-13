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
  changes?: { before?: any; after?: any };
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
    const { page = 1, limit = 20, entity, entityId, userId, action, from, to } = query;

    const where: any = {};
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

  async findOne(id: string) {
    return this.prisma.auditLog.findUnique({ where: { id } });
  }
}
