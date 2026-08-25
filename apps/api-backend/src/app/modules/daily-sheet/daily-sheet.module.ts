import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_NAMES } from '@water-supply-crm/queue';
import { DailySheetService } from './daily-sheet.service';
import { DailySheetController } from './daily-sheet.controller';
import { DailySheetProcessor } from './daily-sheet.processor';
import { DailySheetPdfService } from './pdf/daily-sheet-pdf.service';
import { BulkImportService } from './bulk-import.service';
import { AuditModule } from '../audit/audit.module';
import { DeliveryIssueModule } from '../delivery-issue/delivery-issue.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { StorageModule } from '../../common/storage/storage.module';
import { WarehouseModule } from '../warehouse/warehouse.module';
import { CollectionPolicyModule } from '../collection-policy/collection-policy.module';
import { PayrollModule } from '../payroll/payroll.module';
import { FleetModule } from '../fleet/fleet.module';
import { SheetDiscrepancyCaseModule } from '../sheet-discrepancy-case/sheet-discrepancy-case.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE_NAMES.DAILY_SHEET_GENERATION }),
    AuditModule,
    // Circular: DeliveryIssueService.plan()/bulkSchedule() (Delivery Issues
    // Phase 2/3) need to call DailySheetService.moveDeliveryItems() the other
    // way — forwardRef on both module imports (see delivery-issue.module.ts)
    // and both constructor injections breaks the cycle for Nest's DI resolver.
    forwardRef(() => DeliveryIssueModule),
    NotificationsModule,
    StorageModule,
    WarehouseModule,
    CollectionPolicyModule,
    PayrollModule,
    FleetModule,
    SheetDiscrepancyCaseModule,
  ],
  controllers: [DailySheetController],
  providers: [DailySheetService, DailySheetProcessor, DailySheetPdfService, BulkImportService],
  exports: [DailySheetService],
})
export class DailySheetModule {}
