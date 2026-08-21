import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_NAMES } from '@water-supply-crm/queue';
import { VehicleController } from './vehicle.controller';
import { VehicleService } from './vehicle.service';
import { VehicleProfileController } from './vehicle-profile.controller';
import { VehicleProfileService } from './vehicle-profile.service';
import { VehicleCheckController } from './vehicle-check.controller';
import { VehicleCheckService } from './vehicle-check.service';
import { FuelLogController } from './fuel-log.controller';
import { FuelLogService } from './fuel-log.service';
import { VehicleMaintenanceController } from './vehicle-maintenance.controller';
import { VehicleMaintenanceService } from './vehicle-maintenance.service';
import { FleetDashboardController } from './fleet-dashboard.controller';
import { FleetDashboardService } from './fleet-dashboard.service';
import { FleetNotificationService } from './fleet-notification.service';
import { FleetProcessor } from './fleet.processor';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { StorageModule } from '../../common/storage/storage.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE_NAMES.FLEET_NOTIFICATIONS }),
    AuditModule,
    NotificationsModule,
    StorageModule,
  ],
  controllers: [
    VehicleController,
    VehicleProfileController,
    VehicleCheckController,
    FuelLogController,
    VehicleMaintenanceController,
    FleetDashboardController,
  ],
  providers: [
    VehicleService,
    VehicleProfileService,
    VehicleCheckService,
    FuelLogService,
    VehicleMaintenanceService,
    FleetDashboardService,
    FleetNotificationService,
    FleetProcessor,
  ],
  // VehicleCheckService is consumed by DailySheetModule for the trip-start gate
  // (assertTripStartClear) — the same cross-module composition style already
  // used for CrewCashDistributionService (see daily-sheet.module.ts).
  exports: [VehicleCheckService],
})
export class FleetModule {}
