import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { AuthUser } from '@water-supply-crm/types';
import { WhatsAppAccountService } from './whatsapp-account.service';
import { AssignableVendorsQueryDto, AssignVendorDto, PlatformWhatsAppListQueryDto, UnassignVendorDto } from './dto/platform-whatsapp.dto';
import { RequireSuperAdmin } from '../../common/decorators/authz-markers.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

/** Platform surface: super admin lists WhatsApp senders and assigns / unassigns vendors. Never exposes tokens. */
@Controller('platform/whatsapp-accounts')
@RequireSuperAdmin()
export class PlatformWhatsAppController {
  constructor(private readonly accounts: WhatsAppAccountService) {}

  /** No filters/paging => legacy array (vendor-dashboard picker); otherwise the paginated detailed list. */
  @Get()
  list(@Query() q: PlatformWhatsAppListQueryDto) {
    if (q.page === undefined && q.limit === undefined && !q.status && !q.q) return this.accounts.listAccounts();
    return this.accounts.listAccountsDetailed(q);
  }

  @Get('assignable-vendors')
  assignableVendors(@Query() q: AssignableVendorsQueryDto) {
    return this.accounts.assignableVendors(q.q);
  }

  @Post(':id/assign')
  @Throttle({ short: { ttl: 2000, limit: 2 }, medium: { ttl: 60000, limit: 10 } })
  assign(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: AssignVendorDto) {
    return this.accounts.assignVendor(id, dto.vendorId, { replace: dto.replace }, user);
  }

  @Post(':id/unassign')
  @Throttle({ short: { ttl: 2000, limit: 2 }, medium: { ttl: 60000, limit: 10 } })
  unassign(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: UnassignVendorDto) {
    return this.accounts.unassignVendor(id, dto.vendorId, user);
  }

  @Post(':id/verify')
  @Throttle({ short: { ttl: 2000, limit: 2 }, medium: { ttl: 60000, limit: 10 } })
  verify(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.accounts.verifyAccountById(id, user);
  }
}
