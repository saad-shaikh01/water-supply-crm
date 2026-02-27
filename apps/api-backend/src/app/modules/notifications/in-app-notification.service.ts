import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { paginate } from '../../common/helpers/paginate';

export interface CreateInAppNotificationDto {
  userId: string;
  vendorId?: string;
  type: string;
  title: string;
  message: string;
  entityId?: string;
}

@Injectable()
export class InAppNotificationService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateInAppNotificationDto) {
    return this.prisma.inAppNotification.create({ data: dto });
  }

  async getForUser(
    userId: string,
    page = 1,
    limit = 20,
    isRead?: boolean,
  ) {
    const where: any = { userId };
    if (isRead !== undefined) where.isRead = isRead;

    const [data, total] = await Promise.all([
      this.prisma.inAppNotification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.inAppNotification.count({ where }),
    ]);

    return paginate(data, total, page, limit);
  }

  async markRead(userId: string, notificationId: string) {
    const notification = await this.prisma.inAppNotification.findUnique({
      where: { id: notificationId },
    });
    if (!notification || notification.userId !== userId) {
      throw new NotFoundException('Notification not found');
    }

    return this.prisma.inAppNotification.update({
      where: { id: notificationId },
      data: { isRead: true, readAt: new Date() },
    });
  }

  async markAllRead(userId: string) {
    const result = await this.prisma.inAppNotification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
    return { updated: result.count };
  }

  async getUnreadCount(userId: string): Promise<number> {
    return this.prisma.inAppNotification.count({
      where: { userId, isRead: false },
    });
  }
}
