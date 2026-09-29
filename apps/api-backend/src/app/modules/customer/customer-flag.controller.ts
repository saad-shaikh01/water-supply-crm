import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CustomerFlagService } from './customer-flag.service';
import { ApplyCustomerFlagDto } from './dto/apply-customer-flag.dto';
import { ResolveCustomerFlagDto } from './dto/resolve-customer-flag.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '@water-supply-crm/types';

@Controller('customers/:customerId/flags')
export class CustomerFlagController {
  constructor(private readonly flags: CustomerFlagService) {}

  @Get()
  @RequirePermissions('customers:view')
  history(@CurrentUser() user: AuthUser, @Param('customerId') customerId: string) {
    return this.flags.history(user.vendorId, customerId);
  }

  @Post()
  @RequirePermissions('customer_flags:apply')
  apply(@CurrentUser() user: AuthUser, @Param('customerId') customerId: string, @Body() dto: ApplyCustomerFlagDto) {
    return this.flags.apply(user, customerId, dto);
  }

  @Post(':flagId/resolve')
  @RequirePermissions('customer_flags:apply')
  resolve(
    @CurrentUser() user: AuthUser,
    @Param('customerId') customerId: string,
    @Param('flagId') flagId: string,
    @Body() dto: ResolveCustomerFlagDto,
  ) {
    return this.flags.resolve(user, customerId, flagId, dto);
  }
}
