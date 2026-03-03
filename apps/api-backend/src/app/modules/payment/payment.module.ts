import { Module } from '@nestjs/common';
import { PaymentService } from './payment.service';
import { PaymentPortalController } from './payment-portal.controller';
import { PaymentAdminController } from './payment-admin.controller';
import { WebhookController } from './webhook.controller';
import { PaymobProvider } from './providers/paymob.provider';
import { PAYMENT_PROVIDER } from './providers/payment-provider.interface';
import { TransactionModule } from '../transaction/transaction.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuditModule } from '../audit/audit.module';
import { StorageModule } from '../../common/storage/storage.module';

@Module({
  imports: [
    StorageModule,
    TransactionModule, // provides LedgerService
    NotificationsModule, // provides NotificationService
    AuditModule,
  ],
  controllers: [
    PaymentPortalController,
    PaymentAdminController,
    WebhookController,
  ],
  providers: [
    PaymentService,
    {
      provide: PAYMENT_PROVIDER,
      useClass: PaymobProvider,
    },
  ],
  exports: [PaymentService],
})
export class PaymentModule {}
