import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_NAMES } from '@water-supply-crm/queue';
import { CustomerService } from './customer.service';
import { CustomerController } from './customer.controller';
import { CustomerStatementPdfService } from './pdf/customer-statement-pdf.service';
import { BulkPriceUpdateProcessor } from './bulk-price-update.processor';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    AuditModule,
    BullModule.registerQueue({ name: QUEUE_NAMES.BULK_PRICE_UPDATE }),
  ],
  controllers: [CustomerController],
  providers: [CustomerService, CustomerStatementPdfService, BulkPriceUpdateProcessor],
  exports: [CustomerService],
})
export class CustomerModule {}
