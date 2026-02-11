import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { UserRole } from '@prisma/client';
import { CustomerService } from './customer.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { CustomerQueryDto } from './dto/customer-query.dto';
import { SetCustomPriceDto } from './dto/set-custom-price.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('customers')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CustomerController {
  constructor(private readonly customerService: CustomerService) {}

  @Post()
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF)
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 20 } })
  create(@CurrentUser() user: any, @Body() dto: CreateCustomerDto) {
    return this.customerService.create(user.vendorId, dto);
  }

  @Get()
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF, UserRole.DRIVER)
  findAll(@CurrentUser() user: any, @Query() query: CustomerQueryDto) {
    return this.customerService.findAllPaginated(user.vendorId, query);
  }

  @Get(':id')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF, UserRole.DRIVER)
  findOne(@CurrentUser() user: any, @Param('id') id: string) {
    return this.customerService.findOne(user.vendorId, id);
  }

  @Patch(':id')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF)
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 20 } })
  update(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: UpdateCustomerDto,
  ) {
    return this.customerService.update(user.vendorId, id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.VENDOR_ADMIN)
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 10 } })
  remove(@CurrentUser() user: any, @Param('id') id: string) {
    return this.customerService.remove(user.vendorId, id);
  }

  @Post(':id/custom-prices')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF)
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 20 } })
  setCustomPrice(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: SetCustomPriceDto,
  ) {
    return this.customerService.setCustomPrice(user.vendorId, id, dto);
  }

  @Delete(':id/custom-prices/:productId')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF)
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 10 } })
  removeCustomPrice(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Param('productId') productId: string,
  ) {
    return this.customerService.removeCustomPrice(user.vendorId, id, productId);
  }

  @Get(':id/transactions')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF, UserRole.DRIVER)
  getTransactionHistory(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Query() pagination: PaginationQueryDto,
  ) {
    return this.customerService.getTransactionHistory(
      user.vendorId,
      id,
      pagination,
    );
  }
}
