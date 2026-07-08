import { Controller, Get, Query } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { DateRangeDto } from './analytics.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '@water-supply-crm/types';

// All analytics reads require analytics:view (declared once at the class level).
@Controller('analytics')
@RequirePermissions('analytics:view')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('financial')
  getFinancial(@CurrentUser() user: AuthUser, @Query() dto: DateRangeDto) {
    return this.analyticsService.getFinancial(user.vendorId, dto.from, dto.to);
  }

  @Get('deliveries')
  getDeliveries(@CurrentUser() user: AuthUser, @Query() dto: DateRangeDto) {
    return this.analyticsService.getDeliveries(user.vendorId, dto.from, dto.to);
  }

  @Get('customers')
  getCustomers(@CurrentUser() user: AuthUser, @Query() dto: DateRangeDto) {
    return this.analyticsService.getCustomers(user.vendorId, dto.from, dto.to);
  }

  @Get('staff')
  getStaff(@CurrentUser() user: AuthUser, @Query() dto: DateRangeDto) {
    return this.analyticsService.getStaff(user.vendorId, dto.from, dto.to);
  }
}
