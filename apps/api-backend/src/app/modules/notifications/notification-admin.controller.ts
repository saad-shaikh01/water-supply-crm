import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { NotificationLogService } from './notification-log.service';
import { NotificationLogQueryDto } from './dto/notification-log-query.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '@water-supply-crm/types';

@Controller('notifications')
@RequirePermissions('notifications:view')
export class NotificationAdminController {
  constructor(private readonly logService: NotificationLogService) {}

  /**
   * GET /notifications/logs
   * List notification delivery logs with optional filters.
   */
  @Get('logs')
  findLogs(@CurrentUser() user: AuthUser, @Query() query: NotificationLogQueryDto) {
    return this.logService.findLogs(user.vendorId, query);
  }

  /**
   * GET /notifications/logs/summary
   * Sent/Failed/Skipped + type + error-category counts for the same filters.
   * Declared before `logs/:id` so it is not shadowed.
   */
  @Get('logs/summary')
  summary(@CurrentUser() user: AuthUser, @Query() query: NotificationLogQueryDto) {
    return this.logService.summary(user.vendorId, query);
  }

  /**
   * POST /notifications/logs/:id/retry
   * Re-queue a failed WhatsApp send.
   */
  @Post('logs/:id/retry')
  @RequirePermissions('notifications:configure')
  retry(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.logService.retry(user.vendorId, id);
  }

  /**
   * GET /notifications/logs/:id
   * Get a single notification delivery log entry.
   */
  @Get('logs/:id')
  findLogById(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.logService.findLogById(user.vendorId, id);
  }
}
