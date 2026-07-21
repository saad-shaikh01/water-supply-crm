import { Controller, Get } from '@nestjs/common';
import { WhatsAppService } from './whatsapp.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';

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
      // 'disconnected' here means "enabled but META_WA_ACCESS_TOKEN / META_WA_PHONE_NUMBER_ID
      // missing" (Cloud API is a stateless bearer-token API — no linked-device session to lose).
      status: !enabled ? 'disabled' : ready ? 'connected' : 'disconnected',
    };
  }
}
