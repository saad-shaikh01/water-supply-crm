import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { VehicleMaintenanceService } from './vehicle-maintenance.service';
import { VehicleServiceTypeService } from './vehicle-service-type.service';
import { CreateServiceTypeDto } from './dto/create-service-type.dto';
import { UpdateServiceTypeDto } from './dto/update-service-type.dto';
import { UpdateMaintenanceRuleDto } from './dto/update-maintenance-rule.dto';
import { CreateServiceRecordDto } from './dto/create-service-record.dto';
import { UpdateServiceRecordDto } from './dto/update-service-record.dto';
import { ServiceRecordQueryDto } from './dto/service-record-query.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '@water-supply-crm/types';

@Controller('fleet/maintenance')
export class VehicleMaintenanceController {
  constructor(
    private readonly maintenanceService: VehicleMaintenanceService,
    private readonly serviceTypeService: VehicleServiceTypeService,
  ) {}

  // ── Static routes before parameterised ones ────────────────────────────────

  // Per-vendor service-type catalogue (Record Service dropdown): add custom
  // types, remove ones no service record uses.
  @Get('service-types')
  @RequirePermissions('fleet:view')
  listServiceTypes(@CurrentUser() user: AuthUser) {
    return this.serviceTypeService.list(user.vendorId);
  }

  @Post('service-types')
  @RequirePermissions('fleet:manage_maintenance')
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 20 } })
  createServiceType(@CurrentUser() user: AuthUser, @Body() dto: CreateServiceTypeDto) {
    return this.serviceTypeService.create(user, dto);
  }

  @Patch('service-types/:id')
  @RequirePermissions('fleet:manage_maintenance')
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 20 } })
  renameServiceType(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateServiceTypeDto) {
    return this.serviceTypeService.rename(user, id, dto);
  }

  @Delete('service-types/:id')
  @RequirePermissions('fleet:manage_maintenance')
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 20 } })
  removeServiceType(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.serviceTypeService.remove(user, id);
  }

  @Get('status')
  @RequirePermissions('fleet:view')
  getFleetWideStatus(@CurrentUser() user: AuthUser) {
    return this.maintenanceService.getFleetWideStatus(user.vendorId);
  }

  @Get('service-records')
  @RequirePermissions('fleet:view')
  listServiceRecords(@CurrentUser() user: AuthUser, @Query() query: ServiceRecordQueryDto) {
    return this.maintenanceService.listServiceRecords(user.vendorId, query);
  }

  @Post('service-records')
  @RequirePermissions('fleet:manage_maintenance')
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 30 } })
  createServiceRecord(@CurrentUser() user: AuthUser, @Body() dto: CreateServiceRecordDto) {
    return this.maintenanceService.createServiceRecord(user, dto);
  }

  @Get('service-records/:id')
  @RequirePermissions('fleet:view')
  getServiceRecord(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.maintenanceService.getServiceRecord(user.vendorId, id);
  }

  @Patch('service-records/:id')
  @RequirePermissions('fleet:manage_maintenance')
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 30 } })
  updateServiceRecord(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateServiceRecordDto) {
    return this.maintenanceService.updateServiceRecord(user, id, dto);
  }

  @Delete('service-records/:id')
  @RequirePermissions('fleet:manage_maintenance')
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 10 } })
  removeServiceRecord(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.maintenanceService.removeServiceRecord(user, id);
  }

  @Get('vehicles/:vehicleId/status')
  @RequirePermissions('fleet:view')
  getStatusForVehicle(@CurrentUser() user: AuthUser, @Param('vehicleId') vehicleId: string) {
    return this.maintenanceService.getStatusForVehicle(user.vendorId, vehicleId);
  }

  @Patch('rules/:id')
  @RequirePermissions('fleet:manage_maintenance')
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 30 } })
  updateRule(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateMaintenanceRuleDto) {
    return this.maintenanceService.updateRule(user, id, dto);
  }
}
