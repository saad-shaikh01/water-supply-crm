import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { CustomerFlagCategoryService } from './customer-flag-category.service';
import { CreateCustomerFlagCategoryDto } from './dto/create-customer-flag-category.dto';
import { UpdateCustomerFlagCategoryDto } from './dto/update-customer-flag-category.dto';
import { RequirePermissions, RequireAnyPermission } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '@water-supply-crm/types';

/**
 * Admin-managed catalogue behind Customer Flags — see the schema comment on
 * `CustomerFlagCategory`. `list` is readable by anyone who can either manage
 * the catalogue OR apply a flag (the "flag customer" dialog needs to show the
 * category picker); mutation is `manage_categories`-only.
 */
@Controller('customer-flag-categories')
export class CustomerFlagCategoryController {
  constructor(private readonly categories: CustomerFlagCategoryService) {}

  @Get()
  @RequireAnyPermission('customer_flags:manage_categories', 'customer_flags:apply')
  list(@CurrentUser() user: AuthUser) {
    return this.categories.list(user.vendorId);
  }

  @Post()
  @RequirePermissions('customer_flags:manage_categories')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateCustomerFlagCategoryDto) {
    return this.categories.create(user, dto);
  }

  @Patch(':id')
  @RequirePermissions('customer_flags:manage_categories')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateCustomerFlagCategoryDto) {
    return this.categories.update(user, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('customer_flags:manage_categories')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.categories.remove(user, id);
  }
}
