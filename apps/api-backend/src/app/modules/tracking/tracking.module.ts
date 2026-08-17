import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_NAMES } from '@water-supply-crm/queue';
import { TrackingService } from './tracking.service';
import { TrackingController } from './tracking.controller';
import { TrackingHistoryService } from './tracking-history.service';
import { TrackingSummaryService } from './tracking-summary.service';
import { TrackingCleanupService } from './tracking-cleanup.service';
import { TrackingSchedulerService } from './tracking-scheduler.service';
import { TrackingProcessor } from './tracking.processor';

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.TRACKING_HISTORY })],
  providers: [
    TrackingService,
    TrackingHistoryService,
    TrackingSummaryService,
    TrackingCleanupService,
    TrackingSchedulerService,
    TrackingProcessor,
  ],
  controllers: [TrackingController],
  exports: [TrackingService],
})
export class TrackingModule {}
