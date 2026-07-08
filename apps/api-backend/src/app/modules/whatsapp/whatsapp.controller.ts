import { Controller, Get, Post } from '@nestjs/common';
import { WhatsAppService } from './whatsapp.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';

// Security hardening: previously only @UseGuards(JwtAuthGuard) — i.e. any authenticated
// user could read the QR / status and log the session out. Now explicitly authorized.
@Controller('whatsapp')
export class WhatsAppController {
  constructor(private readonly whatsapp: WhatsAppService) {}

  @Get('status')
  @RequirePermissions('whatsapp:view')
  getStatus() {
    const enabled = process.env['WHATSAPP_ENABLED'] === 'true';
    const ready = this.whatsapp.isReady();
    return {
      enabled,
      ready,
      status: !enabled ? 'disabled' : ready ? 'connected' : 'disconnected',
    };
  }

  @Get('qr')
  @RequirePermissions('whatsapp:view')
  getQr() {
    const qr = this.whatsapp.getQr();
    return { qr };
  }

  @Post('logout')
  @RequirePermissions('whatsapp:manage')
  async logout() {
    await this.whatsapp.logout();
    return { success: true };
  }
}
