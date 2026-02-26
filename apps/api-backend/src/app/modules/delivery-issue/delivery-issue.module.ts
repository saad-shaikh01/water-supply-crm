import { Module } from '@nestjs/common';
import { DeliveryIssueService } from './delivery-issue.service';
import { DeliveryIssueController } from './delivery-issue.controller';

@Module({
  controllers: [DeliveryIssueController],
  providers: [DeliveryIssueService],
  exports: [DeliveryIssueService],
})
export class DeliveryIssueModule {}
