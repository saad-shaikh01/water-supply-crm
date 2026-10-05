import { Module } from '@nestjs/common';
import { VendorService } from './vendor.service';
import { VendorController } from './vendor.controller';
import { VendorProvisioningService } from './vendor-provisioning.service';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  controllers: [VendorController],
  providers: [VendorService, VendorProvisioningService],
})
export class VendorModule {}
