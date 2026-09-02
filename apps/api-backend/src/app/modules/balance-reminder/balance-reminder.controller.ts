import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { BalanceReminderService } from './balance-reminder.service';
import { SendNowDto, SendTargetedDto, PreviewDto, UpdateBalanceReminderConfigDto } from './dto/schedule-reminder.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '@water-supply-crm/types';

@Controller('balance-reminders')
export class BalanceReminderController {
  constructor(private readonly reminderService: BalanceReminderService) {}

  /**
   * GET /balance-reminders/config
   * Effective overdue-warning knobs for the vendor (defaults if no row).
   */
  @Get('config')
  @RequirePermissions('balance_reminders:view')
  getConfig(@CurrentUser() user: AuthUser) {
    return this.reminderService.getConfig(user.vendorId);
  }

  /**
   * PUT /balance-reminders/config
   * Update overdue-warning knobs. Body: { warningDelayDays?: 1-14, warningMinBalance?: number }
   */
  @Put('config')
  @RequirePermissions('balance_reminders:configure')
  updateConfig(@CurrentUser() user: AuthUser, @Body() dto: UpdateBalanceReminderConfigDto) {
    return this.reminderService.updateConfig(user.vendorId, dto);
  }

  /**
   * POST /balance-reminders/send-now
   * Immediately send reminders to all customers with outstanding balance.
   * Body: { minBalance?: number, dryRun?: boolean }
   * Use dryRun=true to preview who would receive messages.
   */
  @Post('send-now')
  @RequirePermissions('balance_reminders:send')
  @Throttle({ short: { ttl: 1000, limit: 1 }, medium: { ttl: 60000, limit: 3 } })
  sendNow(@CurrentUser() user: AuthUser, @Body() dto: SendNowDto) {
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
  @RequirePermissions('balance_reminders:send')
  @Throttle({ short: { ttl: 1000, limit: 1 }, medium: { ttl: 60000, limit: 5 } })
  sendTargeted(@CurrentUser() user: AuthUser, @Body() dto: SendTargetedDto) {
    return this.reminderService.sendTargeted(user.vendorId, dto);
  }

  /**
   * POST /balance-reminders/preview
   * Dry-run preview — returns full eligibility breakdown without sending messages.
   * Body: { mode?: 'single'|'selected'|'eligible', customerIds?: string[], minBalance?: number }
   * Response: { wouldSend: [...], skipped: [{ ..., reason: 'skipped-low-balance' | ... }], totalWouldSend, totalSkipped }
   */
  @Post('preview')
  @RequirePermissions('balance_reminders:view')
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 20 } })
  previewReminders(@CurrentUser() user: AuthUser, @Body() dto: PreviewDto) {
    return this.reminderService.previewReminders(user.vendorId, dto);
  }

  /**
   * GET /balance-reminders/history?page=1&limit=10&dateFrom=2026-07-01&dateTo=2026-07-31&result=sent&kind=WARNING
   * Paginated log of past reminder send operations (manual and cron).
   * result: 'sent' (sent > 0) | 'skipped' (skipped > 0) | omit for all.
   * kind: 'REMINDER' | 'STATEMENT_ONLY' | 'WARNING' | omit for all.
   */
  @Get('history')
  @RequirePermissions('balance_reminders:view')
  getSendHistory(
    @CurrentUser() user: AuthUser,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('result') result?: string,
    @Query('kind') kind?: string,
  ) {
    return this.reminderService.getSendHistory(user.vendorId, page, Math.min(limit, 50), {
      dateFrom: /^\d{4}-\d{2}-\d{2}$/.test(dateFrom ?? '') ? dateFrom : undefined,
      dateTo: /^\d{4}-\d{2}-\d{2}$/.test(dateTo ?? '') ? dateTo : undefined,
      result: result === 'sent' || result === 'skipped' ? result : undefined,
      kind: kind === 'REMINDER' || kind === 'STATEMENT_ONLY' || kind === 'WARNING' ? kind : undefined,
    });
  }

  /**
   * GET /balance-reminders/history/:id
   * Full detail of one send operation — filters used + per-customer results.
   */
  @Get('history/:id')
  @RequirePermissions('balance_reminders:view')
  getSendLogDetail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.reminderService.getSendLogDetail(user.vendorId, id);
  }
}
