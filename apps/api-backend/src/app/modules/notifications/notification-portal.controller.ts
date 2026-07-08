import { Controller, Get, Patch, Param, Query } from '@nestjs/common';
import { InAppNotificationService } from './in-app-notification.service';
import { NotificationFeedQueryDto } from './dto/notification-feed-query.dto';
import { AuthenticatedOnly } from '../../common/decorators/authz-markers.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '@water-supply-crm/types';

// In-app notification bell — every authenticated identity (customer + vendor staff) sees
// their OWN feed (service scopes by userId). Domain D: @AuthenticatedOnly, not customer-only.
@Controller('portal/notifications')
@AuthenticatedOnly()
export class NotificationPortalController {
  constructor(private readonly notifService: InAppNotificationService) {}

  /**
   * GET /portal/notifications
   * Paginated in-app notification feed for the current customer.
   * Optional: ?isRead=false for unread only.
   */
  @Get()
  getNotifications(
    @CurrentUser() user: AuthUser,
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
  getUnreadCount(@CurrentUser() user: AuthUser) {
    return this.notifService.getUnreadCount(user.userId).then((count) => ({ count }));
  }

  /**
   * PATCH /portal/notifications/read-all
   * Mark all notifications as read for the current user.
   */
  @Patch('read-all')
  markAllRead(@CurrentUser() user: AuthUser) {
    return this.notifService.markAllRead(user.userId);
  }

  /**
   * PATCH /portal/notifications/:id/read
   * Mark a single notification as read.
   */
  @Patch(':id/read')
  markRead(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.notifService.markRead(user.userId, id);
  }
}
