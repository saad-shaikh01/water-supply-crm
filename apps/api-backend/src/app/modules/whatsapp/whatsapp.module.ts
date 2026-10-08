import { Module, Global, OnModuleInit } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_NAMES } from '@water-supply-crm/queue';
import { WhatsAppService } from './whatsapp.service';
import { WhatsAppAccountService } from './whatsapp-account.service';
import { WhatsAppHealthProcessor } from './whatsapp-health.processor';
import { PlatformWhatsAppController, VendorWhatsAppAdminController, WhatsAppController } from './whatsapp.controller';
import { MetaCloudApiProvider } from './providers/meta-cloud-api.provider';
import { WHATSAPP_PROVIDER } from './providers/whatsapp-provider.interface';
import { DeliveryReceiptPdfService } from './delivery-receipt-pdf.service';
import { AuditModule } from '../audit/audit.module';
import { logGateStartup } from '../../common/tenant-gate/legacy-vendor-gate';
import { secretKeyConfigured } from '../../common/crypto/secret-box';
import { Logger } from '@nestjs/common';

@Global()
@Module({
  imports: [AuditModule, BullModule.registerQueue({ name: QUEUE_NAMES.WHATSAPP_HEALTH })],
  controllers: [WhatsAppController, VendorWhatsAppAdminController, PlatformWhatsAppController],
  providers: [
    {
      provide: WHATSAPP_PROVIDER,
      useClass: MetaCloudApiProvider,
    },
    WhatsAppService,
    WhatsAppAccountService,
    WhatsAppHealthProcessor,
    DeliveryReceiptPdfService,
  ],
  exports: [WhatsAppService, WhatsAppAccountService, DeliveryReceiptPdfService],
})
export class WhatsAppModule implements OnModuleInit {
  onModuleInit() {
    logGateStartup();
    if (!secretKeyConfigured()) {
      new Logger('WhatsAppModule').warn('WHATSAPP_TOKEN_KEY not set — vendors cannot connect their own WhatsApp account yet (platform env credentials keep working).');
    }
  }
}
