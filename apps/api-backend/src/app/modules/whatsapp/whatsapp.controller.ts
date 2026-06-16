import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { WhatsAppService } from './whatsapp.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@Controller('whatsapp')
@UseGuards(JwtAuthGuard)
export class WhatsAppController {
  constructor(private readonly whatsapp: WhatsAppService) {}

  @Get('status')
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
  getQr() {
    const qr = this.whatsapp.getQr();
    return { qr };
  }

  @Post('logout')
  async logout() {
    await this.whatsapp.logout();
    return { success: true };
  }
}
