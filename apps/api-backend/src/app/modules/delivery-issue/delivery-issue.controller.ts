import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { DeliveryIssueService } from './delivery-issue.service';
import { DeliveryIssueQueryDto } from './dto/delivery-issue-query.dto';
import { PlanIssueDto } from './dto/plan-issue.dto';
import { ResolveIssueDto } from './dto/resolve-issue.dto';
import { BulkScheduleIssuesDto } from './dto/bulk-schedule-issues.dto';
import { BulkResolveIssuesDto } from './dto/bulk-resolve-issues.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '@water-supply-crm/types';

@Controller('delivery-issues')
export class DeliveryIssueController {
  constructor(private readonly issueService: DeliveryIssueService) {}

  @Get()
  @RequirePermissions('delivery_issues:view')
  findAll(@CurrentUser() user: AuthUser, @Query() query: DeliveryIssueQueryDto) {
    return this.issueService.findAll(user.vendorId, query);
  }

  @Get(':id')
  @RequirePermissions('delivery_issues:view')
  findOne(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.issueService.findOne(user.vendorId, id);
  }

  @Patch(':id/plan')
  @RequirePermissions('delivery_issues:plan')
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 30 } })
  plan(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PlanIssueDto,
  ) {
    // Passes the full AuthUser (not just userId) — plan() forwards it to
    // DailySheetService.moveDeliveryItems() when the plan requests an actual
    // reschedule (Phase 2), the same way the Daily Sheet page's Move dialog does.
    return this.issueService.plan(user.vendorId, id, dto, user);
  }

  @Patch(':id/resolve')
  @RequirePermissions('delivery_issues:resolve')
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 30 } })
  resolve(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveIssueDto,
  ) {
    return this.issueService.resolve(user.vendorId, id, dto, user.userId);
  }

  /**
   * PATCH /delivery-issues/bulk-schedule — Phase 3. Always performs a real
   * move, so both permissions are required unconditionally (unlike the
   * single :id/plan route, where a move is only sometimes requested and the
   * daily_sheets:move_customer check happens conditionally inside plan()).
   */
  @Patch('bulk-schedule')
  @RequirePermissions('delivery_issues:plan', 'daily_sheets:move_customer')
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 15 } })
  bulkSchedule(@CurrentUser() user: AuthUser, @Body() dto: BulkScheduleIssuesDto) {
    return this.issueService.bulkSchedule(user.vendorId, dto, user);
  }

  /** PATCH /delivery-issues/bulk-resolve — Phase 4. */
  @Patch('bulk-resolve')
  @RequirePermissions('delivery_issues:resolve')
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 15 } })
  bulkResolve(@CurrentUser() user: AuthUser, @Body() dto: BulkResolveIssuesDto) {
    return this.issueService.bulkResolve(user.vendorId, dto, user.userId);
  }
}
