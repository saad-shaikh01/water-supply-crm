import { Controller, Get, Param, Query } from '@nestjs/common';
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
   * GET /notifications/logs/:id
   * Get a single notification delivery log entry.
   */
  @Get('logs/:id')
  findLogById(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.logService.findLogById(user.vendorId, id);
  }
}
