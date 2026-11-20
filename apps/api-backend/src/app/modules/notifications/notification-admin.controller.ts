import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { NotificationLogService } from './notification-log.service';
import { NotificationLogQueryDto } from './dto/notification-log-query.dto';
import { BulkRetryDto } from './dto/bulk-retry.dto';
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
   * POST /notifications/logs/retry-failed/preview
   * Dry run of "Retry all failed" for the current filters: how many would be retried and why others are skipped.
   */
  @Post('logs/retry-failed/preview')
  @RequirePermissions('notifications:configure')
  previewRetryFailed(@CurrentUser() user: AuthUser, @Body() dto: BulkRetryDto) {
    return this.logService.previewBulkRetry(user.vendorId, dto);
  }

  /**
   * POST /notifications/logs/retry-failed
   * Re-queue every failed WhatsApp send matching the filters that is safe to resend (see previewBulkRetry).
   */
  @Post('logs/retry-failed')
  @RequirePermissions('notifications:configure')
  retryFailed(@CurrentUser() user: AuthUser, @Body() dto: BulkRetryDto) {
    return this.logService.bulkRetry(user.vendorId, dto);
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
