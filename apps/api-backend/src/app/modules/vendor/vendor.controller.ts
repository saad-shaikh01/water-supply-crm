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
import { VendorService } from './vendor.service';
import { CreateVendorDto } from './dto/create-vendor.dto';
import { UpdateVendorDto } from './dto/update-vendor.dto';
import { ResetAdminPasswordDto } from './dto/reset-admin-password.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller('vendors')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN) // All vendor endpoints are SUPER_ADMIN only by default
export class VendorController {
  constructor(private readonly vendorService: VendorService) {}

  /** POST /vendors — Create vendor + admin user */
  @Post()
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 10 } })
  create(@Body() dto: CreateVendorDto) {
    return this.vendorService.create(dto);
  }

  /** GET /vendors — List all vendors with customer/driver counts */
  @Get()
  findAll(@Query() query: PaginationQueryDto) {
    return this.vendorService.findAllPaginated(query);
  }

  /** GET /vendors/:id — Vendor detail */
  @Get(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.VENDOR_ADMIN)
  findOne(@Param('id') id: string) {
    return this.vendorService.findOne(id);
  }

  /** GET /vendors/:id/stats — Deep stats for a vendor */
  @Get(':id/stats')
  getStats(@Param('id') id: string) {
    return this.vendorService.getStats(id);
  }

  /** GET /vendors/:id/users — All users under this vendor */
  @Get(':id/users')
  findVendorUsers(@Param('id') id: string) {
    return this.vendorService.findVendorUsers(id);
  }

  /** PATCH /vendors/:id — Update vendor info */
  @Patch(':id')
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 20 } })
  update(@Param('id') id: string, @Body() dto: UpdateVendorDto) {
    return this.vendorService.update(id, dto);
  }

  /** PATCH /vendors/:id/suspend — Disable vendor + block all users via Redis */
  @Patch(':id/suspend')
  suspend(@Param('id') id: string) {
    return this.vendorService.suspend(id);
  }

  /** PATCH /vendors/:id/unsuspend — Restore vendor access */
  @Patch(':id/unsuspend')
  unsuspend(@Param('id') id: string) {
    return this.vendorService.unsuspend(id);
  }

  /** POST /vendors/:id/reset-admin-password — Force-reset vendor admin password */
  @Post(':id/reset-admin-password')
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 10 } })
  resetAdminPassword(
    @Param('id') id: string,
    @Body() dto: ResetAdminPasswordDto,
  ) {
    return this.vendorService.resetAdminPassword(id, dto.newPassword);
  }

  /** DELETE /vendors/:id — Permanent delete (blocked if transactions exist) */
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.vendorService.remove(id);
  }
}
