import { Module, Global } from '@nestjs/common';
import { WhatsAppService } from './whatsapp.service';
import { WhatsAppWebProvider } from './providers/whatsapp-web.provider';
import { WHATSAPP_PROVIDER } from './providers/whatsapp-provider.interface';

@Global()
@Module({
  providers: [
    {
      provide: WHATSAPP_PROVIDER,
      useClass: WhatsAppWebProvider,
    },
    WhatsAppService,
  ],
  exports: [WhatsAppService],
})
export class WhatsAppModule {}
