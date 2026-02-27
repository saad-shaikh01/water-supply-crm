import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { NotificationLogService } from './notification-log.service';
import { NotificationLogQueryDto } from './dto/notification-log-query.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller('notifications')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF)
export class NotificationAdminController {
  constructor(private readonly logService: NotificationLogService) {}

  /**
   * GET /notifications/logs
   * List notification delivery logs with optional filters.
   * Query: channel, status, eventType, recipientType, recipientId, dateFrom, dateTo
   */
  @Get('logs')
  findLogs(@Query() query: NotificationLogQueryDto) {
    return this.logService.findLogs(query);
  }

  /**
   * GET /notifications/logs/:id
   * Get a single notification delivery log entry.
   */
  @Get('logs/:id')
  findLogById(@Param('id') id: string) {
    return this.logService.findLogById(id);
  }
}
