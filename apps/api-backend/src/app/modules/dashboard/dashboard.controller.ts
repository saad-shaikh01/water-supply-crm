import { Controller, Get, Query } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { DashboardQueryDto } from './dto/dashboard-query.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { RequireSuperAdmin } from '../../common/decorators/authz-markers.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '@water-supply-crm/types';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  /** GET /dashboard/platform — Platform-wide stats (SUPER_ADMIN only; Domain B). */
  @Get('platform')
  @RequireSuperAdmin()
  getPlatformOverview() {
    return this.dashboardService.getPlatformOverview();
  }

  @Get('overview')
  @RequirePermissions('dashboard:view')
  getOverview(@CurrentUser() user: AuthUser) {
    return this.dashboardService.getOverview(user.vendorId);
  }

  @Get('daily-stats')
  @RequirePermissions('dashboard:view')
  getDailyStats(@CurrentUser() user: AuthUser, @Query() query: DashboardQueryDto) {
    return this.dashboardService.getDailyStats(user.vendorId, query.date);
  }

  // Revenue was VENDOR_ADMIN-only → gated with analytics:view (stricter than dashboard:view).
  @Get('revenue')
  @RequirePermissions('analytics:view')
  getRevenue(@CurrentUser() user: AuthUser, @Query() query: DashboardQueryDto) {
    return this.dashboardService.getRevenue(
      user.vendorId,
      query.dateFrom,
      query.dateTo,
    );
  }

  @Get('top-customers')
  @RequirePermissions('dashboard:view')
  getTopCustomers(@CurrentUser() user: AuthUser, @Query() query: DashboardQueryDto) {
    return this.dashboardService.getTopCustomers(user.vendorId, query.limit);
  }

  @Get('route-performance')
  @RequirePermissions('dashboard:view')
  getRoutePerformance(
    @CurrentUser() user: AuthUser,
    @Query() query: DashboardQueryDto,
  ) {
    return this.dashboardService.getRoutePerformance(user.vendorId, query.date);
  }

  /** GET /dashboard/performance/staff?from=2026-01-01&to=2026-01-31 */
  @Get('performance/staff')
  @RequirePermissions('dashboard:view')
  getStaffPerformance(
    @CurrentUser() user: AuthUser,
    @Query() query: DashboardQueryDto,
  ) {
    return this.dashboardService.getStaffPerformance(
      user.vendorId,
      query.dateFrom,
      query.dateTo,
    );
  }

  /** GET /dashboard/monthly-summary?months=6 */
  @Get('monthly-summary')
  @RequirePermissions('dashboard:view')
  getMonthlySummary(
    @CurrentUser() user: AuthUser,
    @Query() query: DashboardQueryDto,
  ) {
    return this.dashboardService.getMonthlySummary(user.vendorId, query.months);
  }
}
