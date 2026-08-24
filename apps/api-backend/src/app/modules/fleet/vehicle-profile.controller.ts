import { Controller, Get, Post, Patch, Body, Param, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { VehicleProfileService } from './vehicle-profile.service';
import { UpdateVehicleProfileDto } from './dto/update-vehicle-profile.dto';
import { CreateVehicleDocumentDto } from './dto/create-vehicle-document.dto';
import { UpdateVehicleDocumentDto } from './dto/update-vehicle-document.dto';
import { VehicleQueryDto } from './dto/vehicle-query.dto';
import { RequirePermissions, RequireAnyPermission } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '@water-supply-crm/types';

@Controller('fleet/vehicles')
export class VehicleProfileController {
  constructor(private readonly vehicleProfileService: VehicleProfileService) {}

  /**
   * Also the vehicle-picker source for the Vehicle Check start form (§17.3) via
   * ?active=true. Driver/Salesman hold fleet:record_check/fleet:record_fuel but
   * deliberately NOT fleet:view (no dedicated Fleet screen for them) — same gap
   * already handled on VehicleCheckController#getForSheet — so this list must
   * accept any of the three, not just fleet:view, or the picker comes back
   * empty for them.
   */
  @Get()
  @RequireAnyPermission('fleet:view', 'fleet:record_check', 'fleet:record_fuel')
  findAll(@CurrentUser() user: AuthUser, @Query() query: VehicleQueryDto) {
    return this.vehicleProfileService.findAll(user.vendorId, query);
  }

  @Get(':vehicleId')
  @RequirePermissions('fleet:view')
  findOne(@CurrentUser() user: AuthUser, @Param('vehicleId') vehicleId: string) {
    return this.vehicleProfileService.findOne(user.vendorId, vehicleId);
  }

  @Patch(':vehicleId')
  @RequirePermissions('fleet:update')
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 30 } })
  updateProfile(
    @CurrentUser() user: AuthUser,
    @Param('vehicleId') vehicleId: string,
    @Body() dto: UpdateVehicleProfileDto,
  ) {
    return this.vehicleProfileService.updateProfile(user, vehicleId, dto);
  }

  @Post(':vehicleId/documents')
  @RequirePermissions('fleet:update')
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 30 } })
  addDocument(
    @CurrentUser() user: AuthUser,
    @Param('vehicleId') vehicleId: string,
    @Body() dto: CreateVehicleDocumentDto,
  ) {
    return this.vehicleProfileService.addDocument(user, vehicleId, dto);
  }

  @Patch('documents/:id')
  @RequirePermissions('fleet:update')
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 30 } })
  updateDocument(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateVehicleDocumentDto,
  ) {
    return this.vehicleProfileService.updateDocument(user, id, dto);
  }

  @Patch('documents/:id/deactivate')
  @RequirePermissions('fleet:update')
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 10 } })
  deactivateDocument(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.vehicleProfileService.deactivateDocument(user, id);
  }
}
