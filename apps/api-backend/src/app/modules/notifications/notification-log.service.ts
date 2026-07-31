import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { paginate } from '../../common/helpers/paginate';
import { NotificationLogQueryDto } from './dto/notification-log-query.dto';

@Injectable()
export class NotificationLogService {
  constructor(private readonly prisma: PrismaService) {}

  async findLogs(vendorId: string, query: NotificationLogQueryDto) {
    const {
      page = 1,
      limit = 20,
      channel,
      status,
      eventType,
      recipientType,
      recipientId,
      search,
      dateFrom,
      dateTo,
    } = query;

    const where: any = { vendorId };
    if (channel) where.channel = channel;
    if (status) where.status = status;
    if (eventType) where.eventType = eventType;
    if (recipientType) where.recipientType = recipientType;
    if (recipientId) where.recipientId = recipientId;
    if (search) where.recipientAddress = { contains: search, mode: 'insensitive' };
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

    const enriched = await this.attachCustomerAndSheet(data);
    return paginate(enriched, total, page, limit);
  }

  /**
   * Attaches customer name/code + the daily sheet a delivery notification belongs to.
   * recipientId/entityId are loose string fields (not Prisma relations), so this is a
   * manual batch join rather than a Prisma `include`.
   */
  private async attachCustomerAndSheet<T extends { recipientType: string | null; recipientId: string | null; entityType: string | null; entityId: string | null }>(
    logs: T[],
  ) {
    const deliveryItemIds = [...new Set(logs.filter((l) => l.entityType === 'DELIVERY_ITEM' && l.entityId).map((l) => l.entityId as string))];
    const items = deliveryItemIds.length
      ? await this.prisma.dailySheetItem.findMany({
          where: { id: { in: deliveryItemIds } },
          select: { id: true, dailySheetId: true, customerId: true },
        })
      : [];
    const itemById = new Map(items.map((i) => [i.id, i]));

    const customerIds = new Set<string>();
    for (const log of logs) {
      if (log.recipientType === 'CUSTOMER' && log.recipientId) customerIds.add(log.recipientId);
      const item = log.entityType === 'DELIVERY_ITEM' && log.entityId ? itemById.get(log.entityId) : undefined;
      if (item?.customerId) customerIds.add(item.customerId);
    }
    const customers = customerIds.size
      ? await this.prisma.customer.findMany({
          where: { id: { in: [...customerIds] } },
          select: { id: true, name: true, customerCode: true },
        })
      : [];
    const customerById = new Map(customers.map((c) => [c.id, c]));

    return logs.map((log) => {
      const item = log.entityType === 'DELIVERY_ITEM' && log.entityId ? itemById.get(log.entityId) : undefined;
      const customerId = (log.recipientType === 'CUSTOMER' ? log.recipientId : null) ?? item?.customerId ?? null;
      const customer = customerId ? customerById.get(customerId) : undefined;
      return {
        ...log,
        customerName: customer?.name ?? null,
        customerCode: customer?.customerCode ?? null,
        dailySheetId: item?.dailySheetId ?? null,
      };
    });
  }

  async findLogById(vendorId: string, id: string) {
    const log = await this.prisma.notificationLog.findFirst({ where: { id, vendorId } });
    if (!log) throw new NotFoundException('Notification log not found');
    return log;
  }

  /** Records a send that never reached the queue because the vendor disabled this flow/channel. */
  async logSkipped(params: {
    channel: string;
    recipientAddress?: string | null;
    eventType?: string | null;
    entityType?: string | null;
    entityId?: string | null;
    recipientType?: string | null;
    recipientId?: string | null;
    vendorId?: string | null;
  }) {
    await this.prisma.notificationLog
      .create({
        data: {
          channel: params.channel,
          status: 'SKIPPED',
          recipientAddress: params.recipientAddress ?? null,
          eventType: params.eventType ?? null,
          entityType: params.entityType ?? null,
          entityId: params.entityId ?? null,
          recipientType: params.recipientType ?? null,
          recipientId: params.recipientId ?? null,
          vendorId: params.vendorId ?? null,
          attemptCount: 0,
          lastError: 'Disabled by vendor notification settings',
          queuedAt: new Date(),
        },
      })
      .catch(() => null);
  }
}
