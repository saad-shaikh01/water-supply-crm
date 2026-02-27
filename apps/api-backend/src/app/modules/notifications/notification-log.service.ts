import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { paginate } from '../../common/helpers/paginate';
import { NotificationLogQueryDto } from './dto/notification-log-query.dto';

@Injectable()
export class NotificationLogService {
  constructor(private readonly prisma: PrismaService) {}

  async findLogs(query: NotificationLogQueryDto) {
    const {
      page = 1,
      limit = 20,
      channel,
      status,
      eventType,
      recipientType,
      recipientId,
      dateFrom,
      dateTo,
    } = query;

    const where: any = {};
    if (channel) where.channel = channel;
    if (status) where.status = status;
    if (eventType) where.eventType = eventType;
    if (recipientType) where.recipientType = recipientType;
    if (recipientId) where.recipientId = recipientId;
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = new Date(dateFrom);
      if (dateTo) where.createdAt.lte = new Date(dateTo);
    }

    const [data, total] = await Promise.all([
      this.prisma.notificationLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.notificationLog.count({ where }),
    ]);

    return paginate(data, total, page, limit);
  }

  async findLogById(id: string) {
    const log = await this.prisma.notificationLog.findUnique({ where: { id } });
    if (!log) throw new NotFoundException('Notification log not found');
    return log;
  }
}
