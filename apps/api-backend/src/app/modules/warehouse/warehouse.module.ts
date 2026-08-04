import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_NAMES } from '@water-supply-crm/queue';
import { WarehouseService } from './warehouse.service';
import { WarehouseController } from './warehouse.controller';
import { WarehouseProcessor } from './warehouse.processor';

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.WAREHOUSE_AUTO_REFILL })],
  controllers: [WarehouseController],
  providers: [WarehouseService, WarehouseProcessor],
  exports: [WarehouseService],
})
export class WarehouseModule {}
