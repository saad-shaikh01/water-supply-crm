import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { UserRole } from '@prisma/client';
import { BalanceReminderService } from './balance-reminder.service';
import { ScheduleReminderDto, SendNowDto, SendTargetedDto, PreviewDto } from './dto/schedule-reminder.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('balance-reminders')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.VENDOR_ADMIN)
export class BalanceReminderController {
  constructor(private readonly reminderService: BalanceReminderService) {}

  /**
   * POST /balance-reminders/schedule
   * Configure automatic daily balance reminders via BullMQ repeatable job.
   * Body: { cronExpression?: string, minBalance?: number }
   * Default: runs daily at 9 AM PKT (04:00 UTC), minBalance=100
   */
  @Post('schedule')
  @Throttle({ short: { ttl: 1000, limit: 1 }, medium: { ttl: 60000, limit: 3 } })
  scheduleReminders(
    @CurrentUser() user: any,
    @Body() dto: ScheduleReminderDto,
  ) {
    return this.reminderService.scheduleReminders(user.vendorId, dto);
  }

  /**
   * GET /balance-reminders/schedule
   * Check if reminders are scheduled and when the next run is.
   */
  @Get('schedule')
  getSchedule(@CurrentUser() user: any) {
    return this.reminderService.getScheduleStatus(user.vendorId);
  }

  /**
   * DELETE /balance-reminders/schedule
   * Disable automatic balance reminders.
   */
  @Delete('schedule')
  @Throttle({ short: { ttl: 1000, limit: 1 }, medium: { ttl: 60000, limit: 3 } })
  cancelReminders(@CurrentUser() user: any) {
    return this.reminderService.cancelReminders(user.vendorId);
  }

  /**
   * POST /balance-reminders/send-now
   * Immediately send reminders to all customers with outstanding balance.
   * Body: { minBalance?: number, dryRun?: boolean }
   * Use dryRun=true to preview who would receive messages.
   */
  @Post('send-now')
  @Throttle({ short: { ttl: 1000, limit: 1 }, medium: { ttl: 60000, limit: 3 } })
  sendNow(@CurrentUser() user: any, @Body() dto: SendNowDto) {
    return this.reminderService.sendNow(user.vendorId, dto);
  }

  /**
   * POST /balance-reminders/send-targeted
   * Send reminders to a targeted subset of customers.
   * Body: { mode: 'single'|'selected'|'eligible', customerIds?: string[], minBalance?: number, dryRun?: boolean, force?: boolean }
   *   mode=single   — exactly one customer (customerIds[0])
   *   mode=selected — explicit list of customer IDs
   *   mode=eligible — all customers above minBalance threshold
   */
  @Post('send-targeted')
  @Throttle({ short: { ttl: 1000, limit: 1 }, medium: { ttl: 60000, limit: 5 } })
  sendTargeted(@CurrentUser() user: any, @Body() dto: SendTargetedDto) {
    return this.reminderService.sendTargeted(user.vendorId, dto);
  }

  /**
   * POST /balance-reminders/preview
   * Dry-run preview — returns full eligibility breakdown without sending messages.
   * Body: { mode?: 'single'|'selected'|'eligible', customerIds?: string[], minBalance?: number }
   * Response: { wouldSend: [...], skipped: [{ ..., reason: 'skipped-low-balance' | ... }], totalWouldSend, totalSkipped }
   */
  @Post('preview')
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 20 } })
  previewReminders(@CurrentUser() user: any, @Body() dto: PreviewDto) {
    return this.reminderService.previewReminders(user.vendorId, dto);
  }
}
