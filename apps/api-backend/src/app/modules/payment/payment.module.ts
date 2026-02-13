import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { join } from 'path';
import { PaymentService } from './payment.service';
import { PaymentPortalController } from './payment-portal.controller';
import { PaymentAdminController } from './payment-admin.controller';
import { WebhookController } from './webhook.controller';
import { PaymobProvider } from './providers/paymob.provider';
import { PAYMENT_PROVIDER } from './providers/payment-provider.interface';
import { TransactionModule } from '../transaction/transaction.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    MulterModule.register({
      dest: join(process.cwd(), 'uploads', 'payment-screenshots'),
    }),
    TransactionModule, // provides LedgerService
    NotificationsModule, // provides NotificationService
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
