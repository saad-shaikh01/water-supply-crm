import { Module, forwardRef } from '@nestjs/common';
import { DeliveryIssueService } from './delivery-issue.service';
import { DeliveryIssueController } from './delivery-issue.controller';
import { DailySheetModule } from '../daily-sheet/daily-sheet.module';

@Module({
  // Circular with DailySheetModule (see that module's comment) — Delivery
  // Issues Phase 2/3 reuses DailySheetService.moveDeliveryItems() directly
  // instead of duplicating scheduling logic, which requires this reverse edge.
  imports: [forwardRef(() => DailySheetModule)],
  controllers: [DeliveryIssueController],
  providers: [DeliveryIssueService],
  exports: [DeliveryIssueService],
})
export class DeliveryIssueModule {}
