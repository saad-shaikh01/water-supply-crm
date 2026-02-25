import { Module } from '@nestjs/common';
import { OrderService } from './order.service';
import { OrderPortalController } from './order-portal.controller';
import { OrderAdminController } from './order-admin.controller';

@Module({
  controllers: [OrderPortalController, OrderAdminController],
  providers: [OrderService],
})
export class OrderModule {}
