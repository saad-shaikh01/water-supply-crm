import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { UserRole } from '@prisma/client';
import { VendorService } from './vendor.service';
import { VendorProvisioningService } from './vendor-provisioning.service';
import { CreateVendorDto } from './dto/create-vendor.dto';
import { UpdateVendorDto } from './dto/update-vendor.dto';
import { ResetAdminPasswordDto } from './dto/reset-admin-password.dto';
import { ListVendorsQueryDto } from './dto/list-vendors-query.dto';
import { VendorUsersQueryDto } from './dto/vendor-users-query.dto';
import { SuspendVendorDto } from './dto/suspend-vendor.dto';
import { BulkVendorActionDto } from './dto/bulk-vendor-action.dto';
import { RequireSuperAdmin, RequireRoles } from '../../common/decorators/authz-markers.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '@water-supply-crm/types';

// Domain B — platform surface. Super-admin only by default (outside the vendor catalog).
@Controller('vendors')
@RequireSuperAdmin()
export class VendorController {
  constructor(
    private readonly vendorService: VendorService,
    private readonly provisioning: VendorProvisioningService,
  ) {}

  /** POST /vendors — Create vendor + admin user */
  @Post()
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 10 } })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateVendorDto) {
    return this.vendorService.create(dto, user);
  }

  /** POST /vendors/bulk/suspend — declared before the `:id` routes so it is never captured by them. */
  @Post('bulk/suspend')
  @Throttle({ short: { ttl: 1000, limit: 1 }, medium: { ttl: 60000, limit: 5 } })
  bulkSuspend(@CurrentUser() user: AuthUser, @Body() dto: BulkVendorActionDto) {
    return this.vendorService.bulkSetSuspended('suspend', dto.vendorIds, user, dto.reason);
  }

  @Post('bulk/unsuspend')
  @Throttle({ short: { ttl: 1000, limit: 1 }, medium: { ttl: 60000, limit: 5 } })
  bulkUnsuspend(@CurrentUser() user: AuthUser, @Body() dto: BulkVendorActionDto) {
    return this.vendorService.bulkSetSuspended('unsuspend', dto.vendorIds, user, dto.reason);
  }

  /**
   * POST /vendors/:id/provision — "Repair Vendor Setup". Idempotently re-runs onboarding
   * provisioning (system roles, preset-permission catch-up, role-less users, starter
   * catalogues). Never rewrites an existing role's customised permissions.
   */
  @Post(':id/provision')
  @Throttle({ short: { ttl: 1000, limit: 2 }, medium: { ttl: 60000, limit: 10 } })
  provision(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.provisioning.repair(id, user);
  }

  /** GET /vendors — List all vendors with customer/driver counts */
  @Get()
  findAll(@Query() query: ListVendorsQueryDto) {
    return this.vendorService.findAllPaginated(query);
  }

  /**
   * GET /vendors/:id — Vendor detail.
   * SUPER_ADMIN (any vendor) or VENDOR_ADMIN (their own — enforced in the service,
   * C5 fix; see vendor.service.spec.ts).
   */
  @Get(':id')
  @RequireRoles(UserRole.SUPER_ADMIN, UserRole.VENDOR_ADMIN)
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.vendorService.findOne(id, user);
  }

  /** GET /vendors/:id/stats — Deep stats for a vendor */
  @Get(':id/stats')
  getStats(@Param('id') id: string) {
    return this.vendorService.getStats(id);
  }

  /** GET /vendors/:id/users — All users under this vendor */
  @Get(':id/users')
  findVendorUsers(@Param('id') id: string, @Query() query: VendorUsersQueryDto) {
    return this.vendorService.findVendorUsers(id, query);
  }

  /** PATCH /vendors/:id — Update vendor info */
  @Patch(':id')
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 20 } })
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateVendorDto) {
    return this.vendorService.update(id, dto, user);
  }

  /** PATCH /vendors/:id/suspend — Disable vendor + block all users via Redis */
  @Patch(':id/suspend')
  suspend(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: SuspendVendorDto) {
    return this.vendorService.suspend(id, user, dto.reason);
  }

  /** PATCH /vendors/:id/unsuspend — Restore vendor access */
  @Patch(':id/unsuspend')
  unsuspend(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: SuspendVendorDto) {
    return this.vendorService.unsuspend(id, user, dto.reason);
  }

  /** POST /vendors/:id/reset-admin-password — Force-reset vendor admin password */
  @Post(':id/reset-admin-password')
  @Throttle({ short: { ttl: 1000, limit: 1 }, medium: { ttl: 60000, limit: 5 } })
  resetAdminPassword(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: ResetAdminPasswordDto,
  ) {
    return this.vendorService.resetAdminPassword(id, dto, user);
  }

  /** DELETE /vendors/:id — Permanent delete (blocked if transactions exist) */
  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.vendorService.remove(id, user);
  }
}
