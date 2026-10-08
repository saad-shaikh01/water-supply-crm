import { Global, Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { StorageModule } from '../../common/storage/storage.module';
import { CustomerStatementPdfService } from '../customer/pdf/customer-statement-pdf.service';
import { DeliveryReceiptPdfService } from '../whatsapp/delivery-receipt-pdf.service';
import { CompanyProfileController, VendorBrandingAdminController } from './vendor-branding.controller';
import { VendorBrandingService } from './vendor-branding.service';

/**
 * Global: every PDF-generating module (customer statements, receipts, salary slips, daily sheets,
 * balance reminders, the notification processor) resolves its vendor's identity through
 * VendorBrandingService.resolveForDocs().
 */
@Global()
@Module({
  imports: [AuditModule, StorageModule],
  controllers: [CompanyProfileController, VendorBrandingAdminController],
  // The two PDF services are stateless; instances here are only used for the sample-document preview.
  providers: [VendorBrandingService, CustomerStatementPdfService, DeliveryReceiptPdfService],
  exports: [VendorBrandingService],
})
export class VendorBrandingModule {}
