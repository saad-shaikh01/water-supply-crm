import { Module } from '@nestjs/common';
import { CustomerService } from './customer.service';
import { CustomerController } from './customer.controller';
import { CustomerStatementPdfService } from './pdf/customer-statement-pdf.service';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  controllers: [CustomerController],
  providers: [CustomerService, CustomerStatementPdfService],
})
export class CustomerModule {}
