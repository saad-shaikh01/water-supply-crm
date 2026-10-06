import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_NAMES } from '@water-supply-crm/queue';
import { AuditModule } from '../audit/audit.module';
import { StorageModule } from '../../common/storage/storage.module';
import { ImportController } from './import.controller';
import { ImportService } from './import.service';
import { ImportExecutorService } from './import-executor.service';
import { ImportProcessor } from './import.processor';

/** Vendor Data Import (onboarding) — design doc: docs/features/vendor-data-import-design.md */
@Module({
  imports: [AuditModule, StorageModule, BullModule.registerQueue({ name: QUEUE_NAMES.VENDOR_IMPORT })],
  controllers: [ImportController],
  providers: [ImportService, ImportExecutorService, ImportProcessor],
})
export class VendorImportModule {}
