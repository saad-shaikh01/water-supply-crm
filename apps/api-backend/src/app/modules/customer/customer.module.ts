import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_NAMES } from '@water-supply-crm/queue';
import { CustomerService } from './customer.service';
import { CustomerController } from './customer.controller';
import { CustomerStatementPdfService } from './pdf/customer-statement-pdf.service';
import { BulkPriceUpdateProcessor } from './bulk-price-update.processor';
import { CustomerFlagCategoryService } from './customer-flag-category.service';
import { CustomerFlagCategoryController } from './customer-flag-category.controller';
import { CustomerFlagService } from './customer-flag.service';
import { CustomerFlagController } from './customer-flag.controller';
import { AuditModule } from '../audit/audit.module';
import { CustomerDepositsModule } from '../customer-deposits/customer-deposits.module';

@Module({
  imports: [
    AuditModule,
    CustomerDepositsModule,
    BullModule.registerQueue({ name: QUEUE_NAMES.BULK_PRICE_UPDATE }),
  ],
  controllers: [CustomerController, CustomerFlagCategoryController, CustomerFlagController],
  providers: [
    CustomerService,
    CustomerStatementPdfService,
    BulkPriceUpdateProcessor,
    CustomerFlagCategoryService,
    CustomerFlagService,
  ],
  exports: [CustomerService],
})
export class CustomerModule {}
