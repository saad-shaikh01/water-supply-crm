import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { OnboardingController, PlatformOnboardingController } from './vendor-readiness.controller';
import { VendorReadinessService } from './vendor-readiness.service';

/** WhatsAppModule is global, so WhatsAppAccountService resolves without an explicit import. */
@Module({
  imports: [AuditModule],
  controllers: [OnboardingController, PlatformOnboardingController],
  providers: [VendorReadinessService],
  exports: [VendorReadinessService],
})
export class VendorReadinessModule {}
