import { Module } from '@nestjs/common';
import { VendorService } from './vendor.service';
import { VendorController } from './vendor.controller';
import { VendorProvisioningService } from './vendor-provisioning.service';
import { VendorWipeController } from './vendor-wipe.controller';
import { VendorWipeService } from './vendor-wipe.service';
import { AuditModule } from '../audit/audit.module';
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuditModule, PlatformSettingsModule, AuthModule],
  controllers: [VendorController, VendorWipeController],
  providers: [VendorService, VendorProvisioningService, VendorWipeService],
})
export class VendorModule {}
