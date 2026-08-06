import { Module } from '@nestjs/common';
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

@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE_NAMES.DAILY_SHEET_GENERATION }),
    AuditModule,
    DeliveryIssueModule,
    NotificationsModule,
    StorageModule,
    WarehouseModule,
    CollectionPolicyModule,
    PayrollModule,
  ],
  controllers: [DailySheetController],
  providers: [DailySheetService, DailySheetProcessor, DailySheetPdfService, BulkImportService],
})
export class DailySheetModule {}
