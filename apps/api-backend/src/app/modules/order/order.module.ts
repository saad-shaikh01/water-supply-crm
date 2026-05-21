import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_NAMES } from '@water-supply-crm/queue';
import { OrderService } from './order.service';
import { OrderPortalController } from './order-portal.controller';
import { OrderAdminController } from './order-admin.controller';
import { AutoDispatchProcessor } from './auto-dispatch.processor';
import { NotificationsModule } from '../notifications/notifications.module';
import { FcmModule } from '../fcm/fcm.module';

@Module({
  imports: [
    NotificationsModule,
    FcmModule,
    BullModule.registerQueue({ name: QUEUE_NAMES.ORDER_DISPATCH }),
  ],
  controllers: [OrderPortalController, OrderAdminController],
  providers: [OrderService, AutoDispatchProcessor],
})
export class OrderModule {}
