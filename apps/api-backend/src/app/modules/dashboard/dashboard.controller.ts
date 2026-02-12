import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { DashboardService } from './dashboard.service';
import { DashboardQueryDto } from './dto/dashboard-query.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('overview')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF)
  getOverview(@CurrentUser() user: any) {
    return this.dashboardService.getOverview(user.vendorId);
  }

  @Get('daily-stats')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF)
  getDailyStats(@CurrentUser() user: any, @Query() query: DashboardQueryDto) {
    return this.dashboardService.getDailyStats(user.vendorId, query.date);
  }

  @Get('revenue')
  @Roles(UserRole.VENDOR_ADMIN)
  getRevenue(@CurrentUser() user: any, @Query() query: DashboardQueryDto) {
    return this.dashboardService.getRevenue(
      user.vendorId,
      query.dateFrom,
      query.dateTo,
    );
  }

  @Get('top-customers')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF)
  getTopCustomers(@CurrentUser() user: any, @Query() query: DashboardQueryDto) {
    return this.dashboardService.getTopCustomers(user.vendorId, query.limit);
  }

  @Get('route-performance')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF)
  getRoutePerformance(
    @CurrentUser() user: any,
    @Query() query: DashboardQueryDto,
  ) {
    return this.dashboardService.getRoutePerformance(user.vendorId, query.date);
  }
}
