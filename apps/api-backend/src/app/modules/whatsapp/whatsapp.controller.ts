import { Body, Controller, Delete, Get, Param, Patch, Post, Put } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { AuthUser } from '@water-supply-crm/types';
import { WhatsAppService } from './whatsapp.service';
import { WhatsAppAccountService } from './whatsapp-account.service';
import { ConnectWhatsAppAccountDto, LinkWhatsAppAccountDto, UpdateWhatsAppSettingsDto } from './dto/whatsapp-account.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { RequireSuperAdmin } from '../../common/decorators/authz-markers.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('whatsapp')
export class WhatsAppController {
  constructor(
    private readonly whatsapp: WhatsAppService,
    private readonly accounts: WhatsAppAccountService,
  ) {}

  /**
   * GET /whatsapp/status — can THIS vendor's customer messages be sent right now, and through which sender?
   * `enabled` is the platform master switch (WHATSAPP_ENABLED); `ready`/`status` describe the caller's own vendor.
   * Credentials, env variable names and other vendors' details are never part of this response.
   */
  @Get('status')
  @RequirePermissions('whatsapp:view')
  async getStatus(@CurrentUser() user: AuthUser) {
    const view = await this.accounts.getView(user.vendorId);
    const enabled = view.masterEnabled;
    const ready = view.sending.allowed;
    return {
      enabled,
      ready,
      status: !enabled ? 'disabled' : ready ? 'connected' : 'disconnected',
      via: view.sending.via,
      account: view.account ? { status: view.account.status, displayNumber: view.account.displayNumber } : null,
    };
  }

  // ── The signed-in vendor's own WhatsApp account (Settings -> WhatsApp) ──────

  @Get('account')
  @RequirePermissions('whatsapp:view')
  getAccount(@CurrentUser() user: AuthUser) {
    return this.accounts.getView(user.vendorId);
  }

  @Put('account')
  @RequirePermissions('whatsapp:manage')
  @Throttle({ short: { ttl: 2000, limit: 2 }, medium: { ttl: 60000, limit: 10 } })
  connect(@CurrentUser() user: AuthUser, @Body() dto: ConnectWhatsAppAccountDto) {
    return this.accounts.connect(user.vendorId, dto, user);
  }

  @Post('account/verify')
  @RequirePermissions('whatsapp:manage')
  @Throttle({ short: { ttl: 2000, limit: 2 }, medium: { ttl: 60000, limit: 10 } })
  verify(@CurrentUser() user: AuthUser) {
    return this.accounts.verifyVendor(user.vendorId, user);
  }

  @Delete('account')
  @RequirePermissions('whatsapp:manage')
  disconnect(@CurrentUser() user: AuthUser) {
    return this.accounts.disconnect(user.vendorId, user);
  }

  @Patch('account/settings')
  @RequirePermissions('whatsapp:manage')
  settings(@CurrentUser() user: AuthUser, @Body() dto: UpdateWhatsAppSettingsDto) {
    return this.accounts.updateSettings(user.vendorId, dto, user);
  }

  /** The message templates this business must have approved on its WhatsApp account, with review status. */
  @Get('account/templates')
  @RequirePermissions('whatsapp:view')
  templates(@CurrentUser() user: AuthUser) {
    return this.accounts.getTemplates(user.vendorId);
  }

  @Post('account/templates/sync')
  @RequirePermissions('whatsapp:manage')
  @Throttle({ short: { ttl: 2000, limit: 2 }, medium: { ttl: 60000, limit: 10 } })
  syncTemplates(@CurrentUser() user: AuthUser) {
    return this.accounts.syncVendorTemplates(user.vendorId, user);
  }
}

/** Platform surface: super admin manages any vendor's sender (and sister brands sharing one). */
@Controller('vendors/:vendorId/whatsapp-account')
@RequireSuperAdmin()
export class VendorWhatsAppAdminController {
  constructor(private readonly accounts: WhatsAppAccountService) {}

  @Get()
  get(@Param('vendorId') vendorId: string) {
    return this.accounts.getView(vendorId, { isSuperAdmin: true });
  }

  @Put()
  @Throttle({ short: { ttl: 2000, limit: 2 }, medium: { ttl: 60000, limit: 10 } })
  connect(@CurrentUser() user: AuthUser, @Param('vendorId') vendorId: string, @Body() dto: ConnectWhatsAppAccountDto) {
    return this.accounts.connect(vendorId, dto, user, { isSuperAdmin: true });
  }

  @Post('verify')
  @Throttle({ short: { ttl: 2000, limit: 2 }, medium: { ttl: 60000, limit: 10 } })
  verify(@CurrentUser() user: AuthUser, @Param('vendorId') vendorId: string) {
    return this.accounts.verifyVendor(vendorId, user, { isSuperAdmin: true });
  }

  @Delete()
  disconnect(@CurrentUser() user: AuthUser, @Param('vendorId') vendorId: string) {
    return this.accounts.disconnect(vendorId, user, { isSuperAdmin: true });
  }

  @Patch('settings')
  settings(@CurrentUser() user: AuthUser, @Param('vendorId') vendorId: string, @Body() dto: UpdateWhatsAppSettingsDto) {
    return this.accounts.updateSettings(vendorId, dto, user, { isSuperAdmin: true });
  }

  @Get('templates')
  templates(@Param('vendorId') vendorId: string) {
    return this.accounts.getTemplates(vendorId, { isSuperAdmin: true });
  }

  @Post('templates/sync')
  @Throttle({ short: { ttl: 2000, limit: 2 }, medium: { ttl: 60000, limit: 10 } })
  syncTemplates(@CurrentUser() user: AuthUser, @Param('vendorId') vendorId: string) {
    return this.accounts.syncVendorTemplates(vendorId, user, { isSuperAdmin: true });
  }

  /** Share an existing sender with this vendor (same owner, e.g. sister brands). */
  @Post('link')
  link(@CurrentUser() user: AuthUser, @Param('vendorId') vendorId: string, @Body() dto: LinkWhatsAppAccountDto) {
    return this.accounts.linkVendor(vendorId, dto.accountId, user);
  }

  /** Adopt the platform env credentials as this vendor's own stored account (Blue Ice migration). */
  @Post('import-platform')
  importPlatform(@CurrentUser() user: AuthUser, @Param('vendorId') vendorId: string) {
    return this.accounts.importPlatformCredentials(vendorId, user);
  }
}

@Controller('platform/whatsapp-accounts')
@RequireSuperAdmin()
export class PlatformWhatsAppController {
  constructor(private readonly accounts: WhatsAppAccountService) {}

  @Get()
  list() {
    return this.accounts.listAccounts();
  }
}
