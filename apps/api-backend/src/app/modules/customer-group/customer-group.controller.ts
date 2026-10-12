import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { AuthUser } from '@water-supply-crm/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { RequireSuperAdmin } from '../../common/decorators/authz-markers.decorator';
import { CustomerGroupService } from './customer-group.service';
import {
  CreateCustomerGroupDto,
  UpdateCustomerGroupDto,
  UpdateGroupingSettingsDto,
} from './dto/customer-group.dto';

@Controller('customer-groups')
export class CustomerGroupController {
  constructor(private readonly service: CustomerGroupService) {}

  /** Whether grouping is on for the signed-in vendor; read by the customer form and list. */
  @Get('settings')
  @RequirePermissions('customers:view')
  getSettings(@CurrentUser() user: AuthUser) {
    return this.service.getSettings(user.vendorId);
  }

  /** Vendor Admin (and Super Admin) only: the same tier that edits the company profile. */
  @Put('settings')
  @RequirePermissions('company_profile:update')
  setSettings(@CurrentUser() user: AuthUser, @Body() dto: UpdateGroupingSettingsDto) {
    return this.service.setEnabled(user.vendorId, dto.enabled);
  }

  @Get()
  @RequirePermissions('customers:view')
  list(@CurrentUser() user: AuthUser, @Query('includeDeleted') includeDeleted?: string) {
    return this.service.list(user.vendorId, includeDeleted === 'true');
  }

  @Post()
  @RequirePermissions('customers:create')
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 30 } })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateCustomerGroupDto) {
    return this.service.create(user.vendorId, dto);
  }

  @Patch(':id')
  @RequirePermissions('customers:update')
  rename(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCustomerGroupDto,
  ) {
    return this.service.rename(user.vendorId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('customers:delete')
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 20 } })
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(user.vendorId, id);
  }
}

/** Platform surface: super admin switches grouping on/off for ANY vendor. */
@Controller('vendors/:vendorId/customer-grouping')
@RequireSuperAdmin()
export class CustomerGroupAdminController {
  constructor(private readonly service: CustomerGroupService) {}

  @Get()
  get(@Param('vendorId', ParseUUIDPipe) vendorId: string) {
    return this.service.getSettings(vendorId);
  }

  @Put()
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 20 } })
  set(@Param('vendorId', ParseUUIDPipe) vendorId: string, @Body() dto: UpdateGroupingSettingsDto) {
    return this.service.setEnabled(vendorId, dto.enabled);
  }
}
