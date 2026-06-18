import { Module, Global } from '@nestjs/common';
import { WhatsAppService } from './whatsapp.service';
import { WhatsAppController } from './whatsapp.controller';
import { WhatsAppWebProvider } from './providers/whatsapp-web.provider';
import { WHATSAPP_PROVIDER } from './providers/whatsapp-provider.interface';
import { DeliveryReceiptPdfService } from './delivery-receipt-pdf.service';

@Global()
@Module({
  controllers: [WhatsAppController],
  providers: [
    {
      provide: WHATSAPP_PROVIDER,
      useClass: WhatsAppWebProvider,
    },
    WhatsAppService,
    DeliveryReceiptPdfService,
  ],
  exports: [WhatsAppService, DeliveryReceiptPdfService],
})
export class WhatsAppModule {}
