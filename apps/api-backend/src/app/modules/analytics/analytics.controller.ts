import { Controller, Get, Query } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { DateRangeDto, ProfitLossDetailsQueryDto, ProfitLossPaymentsQueryDto, ProfitLossQueryDto } from './analytics.dto';
import { ProfitLossService } from './profit-loss.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '@water-supply-crm/types';

// All analytics reads require analytics:view (declared once at the class level).
@Controller('analytics')
@RequirePermissions('analytics:view')
export class AnalyticsController {
  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly profitLossService: ProfitLossService,
  ) {}

  @Get('profit-loss/details')
  getProfitLossDetails(@CurrentUser() user: AuthUser, @Query() dto: ProfitLossDetailsQueryDto) {
    return this.profitLossService.getDetails(user.vendorId, dto.month, dto.category, dto.page, dto.limit);
  }

  @Get('profit-loss/payments')
  getProfitLossPayments(@CurrentUser() user: AuthUser, @Query() dto: ProfitLossPaymentsQueryDto) {
    return this.profitLossService.getPayments(user.vendorId, dto.month, dto.kind, dto.page, dto.limit);
  }

  @Get('profit-loss')
  getProfitLoss(@CurrentUser() user: AuthUser, @Query() dto: ProfitLossQueryDto) {
    return this.profitLossService.getProfitLoss(user.vendorId, dto.month);
  }

  @Get('financial')
  getFinancial(@CurrentUser() user: AuthUser, @Query() dto: DateRangeDto) {
    return this.analyticsService.getFinancial(user.vendorId, dto.from, dto.to, dto.vanId);
  }

  @Get('deliveries')
  getDeliveries(@CurrentUser() user: AuthUser, @Query() dto: DateRangeDto) {
    return this.analyticsService.getDeliveries(user.vendorId, dto.from, dto.to, dto.vanId);
  }

  @Get('customers')
  getCustomers(@CurrentUser() user: AuthUser, @Query() dto: DateRangeDto) {
    return this.analyticsService.getCustomers(user.vendorId, dto.from, dto.to, dto.vanId);
  }

  @Get('staff')
  getStaff(@CurrentUser() user: AuthUser, @Query() dto: DateRangeDto) {
    return this.analyticsService.getStaff(user.vendorId, dto.from, dto.to, dto.vanId);
  }

  @Get('operations')
  getOperations(@CurrentUser() user: AuthUser, @Query() dto: DateRangeDto) {
    return this.analyticsService.getOperations(user.vendorId, dto.from, dto.to, dto.vanId);
  }
}
