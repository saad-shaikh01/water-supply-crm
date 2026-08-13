import { Controller, Get, Post, Patch, Body, Param, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { VehicleProfileService } from './vehicle-profile.service';
import { UpdateVehicleProfileDto } from './dto/update-vehicle-profile.dto';
import { CreateVehicleDocumentDto } from './dto/create-vehicle-document.dto';
import { UpdateVehicleDocumentDto } from './dto/update-vehicle-document.dto';
import { VehicleQueryDto } from './dto/vehicle-query.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '@water-supply-crm/types';

@Controller('fleet/vehicles')
export class VehicleProfileController {
  constructor(private readonly vehicleProfileService: VehicleProfileService) {}

  @Get()
  @RequirePermissions('fleet:view')
  findAll(@CurrentUser() user: AuthUser, @Query() query: VehicleQueryDto) {
    return this.vehicleProfileService.findAll(user.vendorId, query);
  }

  @Get(':vanId')
  @RequirePermissions('fleet:view')
  findOne(@CurrentUser() user: AuthUser, @Param('vanId') vanId: string) {
    return this.vehicleProfileService.findOne(user.vendorId, vanId);
  }

  @Patch(':vanId')
  @RequirePermissions('fleet:update')
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 30 } })
  updateProfile(
    @CurrentUser() user: AuthUser,
    @Param('vanId') vanId: string,
    @Body() dto: UpdateVehicleProfileDto,
  ) {
    return this.vehicleProfileService.updateProfile(user, vanId, dto);
  }

  @Post(':vanId/documents')
  @RequirePermissions('fleet:update')
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 30 } })
  addDocument(
    @CurrentUser() user: AuthUser,
    @Param('vanId') vanId: string,
    @Body() dto: CreateVehicleDocumentDto,
  ) {
    return this.vehicleProfileService.addDocument(user, vanId, dto);
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
