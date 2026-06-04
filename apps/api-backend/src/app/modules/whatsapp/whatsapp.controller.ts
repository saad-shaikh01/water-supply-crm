import { Controller, Get, UseGuards } from '@nestjs/common';
import { WhatsAppService } from './whatsapp.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@Controller('whatsapp')
@UseGuards(JwtAuthGuard)
export class WhatsAppController {
  constructor(private readonly whatsapp: WhatsAppService) {}

  /** GET /whatsapp/status — returns connection state of the WhatsApp client */
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
}
