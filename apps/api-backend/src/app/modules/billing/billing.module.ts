import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_NAMES } from '@water-supply-crm/queue';
import { AuditModule } from '../audit/audit.module';
import { VendorModule } from '../vendor/vendor.module';
import { PlanLimitModule } from './plan-limit.module';
import { PlanController } from './plan.controller';
import { PlanService } from './plan.service';
import { PlatformSubscriptionController, SubscriptionMeController } from './subscription.controller';
import { SubscriptionService } from './subscription.service';
import { InvoiceController } from './invoice.controller';
import { InvoiceService } from './invoice.service';
import { BillingSweepService } from './billing-sweep.service';
import { BillingSweepProcessor } from './billing-sweep.processor';

/** Phase 4 / Track A — plans, subscriptions, manual invoicing and the daily billing sweep. */
@Module({
  imports: [
    AuditModule,
    PlanLimitModule,
    VendorModule, // VendorService.suspend/unsuspend (exported)
    BullModule.registerQueue({ name: QUEUE_NAMES.BILLING }),
  ],
  controllers: [PlanController, PlatformSubscriptionController, SubscriptionMeController, InvoiceController],
  providers: [PlanService, SubscriptionService, InvoiceService, BillingSweepService, BillingSweepProcessor],
  exports: [PlanLimitModule, SubscriptionService],
})
export class BillingModule {}
