import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PlatformSettingsController, PlatformStatusController } from './platform-settings.controller';
import { PlatformSettingsService } from './platform-settings.service';
import { MaintenanceGuard } from './maintenance.guard';

@Module({
  imports: [AuditModule],
  controllers: [PlatformSettingsController, PlatformStatusController],
  providers: [PlatformSettingsService, MaintenanceGuard],
  exports: [PlatformSettingsService, MaintenanceGuard],
})
export class PlatformSettingsModule {}
