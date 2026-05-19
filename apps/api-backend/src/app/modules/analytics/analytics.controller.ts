import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AnalyticsService } from './analytics.service';
import { DateRangeDto } from './analytics.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '@water-supply-crm/types';

@Controller('analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('financial')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF)
  getFinancial(@CurrentUser() user: AuthUser, @Query() dto: DateRangeDto) {
    return this.analyticsService.getFinancial(user.vendorId, dto.from, dto.to);
  }

  @Get('deliveries')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF)
  getDeliveries(@CurrentUser() user: AuthUser, @Query() dto: DateRangeDto) {
    return this.analyticsService.getDeliveries(user.vendorId, dto.from, dto.to);
  }

  @Get('customers')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF)
  getCustomers(@CurrentUser() user: AuthUser, @Query() dto: DateRangeDto) {
    return this.analyticsService.getCustomers(user.vendorId, dto.from, dto.to);
  }

  @Get('staff')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF)
  getStaff(@CurrentUser() user: AuthUser, @Query() dto: DateRangeDto) {
    return this.analyticsService.getStaff(user.vendorId, dto.from, dto.to);
  }
}
