import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { AuthUser } from '@water-supply-crm/types';
import { RequireSuperAdmin } from '../../common/decorators/authz-markers.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { VendorWipeService } from './vendor-wipe.service';
import { WipeVendorDto } from './dto/wipe-vendor.dto';

// Platform surface, super admin only. See docs/features/vendor-data-wipe.md.
@Controller('vendors')
@RequireSuperAdmin()
export class VendorWipeController {
  constructor(private readonly wipeService: VendorWipeService) {}

  /** GET /vendors/:id/wipe/preview — per-table row counts + whether a wipe is currently allowed. Changes nothing. */
  @Get(':id/wipe/preview')
  @Throttle({ short: { ttl: 1000, limit: 2 }, medium: { ttl: 60000, limit: 20 } })
  preview(@Param('id') id: string) {
    return this.wipeService.preview(id);
  }

  /** POST /vendors/:id/wipe — remove every row the vendor owns (vendor record, admin login, roles, branding stay). */
  @Post(':id/wipe')
  @Throttle({ short: { ttl: 1000, limit: 1 }, medium: { ttl: 60000, limit: 3 } })
  wipe(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: WipeVendorDto) {
    return this.wipeService.wipe(user, id, dto);
  }
}
