import { Controller, Get, Patch, Param, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { InAppNotificationService } from './in-app-notification.service';
import { NotificationFeedQueryDto } from './dto/notification-feed-query.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('portal/notifications')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.CUSTOMER)
export class NotificationPortalController {
  constructor(private readonly notifService: InAppNotificationService) {}

  /**
   * GET /portal/notifications
   * Paginated in-app notification feed for the current customer.
   * Optional: ?isRead=false for unread only.
   */
  @Get()
  getNotifications(
    @CurrentUser() user: any,
    @Query() query: NotificationFeedQueryDto,
  ) {
    const { page = 1, limit = 20, isRead } = query;
    return this.notifService.getForUser(user.userId, page, limit, isRead);
  }

  /**
   * GET /portal/notifications/unread-count
   * Returns count of unread notifications (for bell badge).
   */
  @Get('unread-count')
  getUnreadCount(@CurrentUser() user: any) {
    return this.notifService.getUnreadCount(user.userId).then((count) => ({ count }));
  }

  /**
   * PATCH /portal/notifications/read-all
   * Mark all notifications as read for the current user.
   */
  @Patch('read-all')
  markAllRead(@CurrentUser() user: any) {
    return this.notifService.markAllRead(user.userId);
  }

  /**
   * PATCH /portal/notifications/:id/read
   * Mark a single notification as read.
   */
  @Patch(':id/read')
  markRead(@CurrentUser() user: any, @Param('id') id: string) {
    return this.notifService.markRead(user.userId, id);
  }
}
