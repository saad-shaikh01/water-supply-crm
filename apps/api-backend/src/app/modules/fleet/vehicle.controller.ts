import { Controller, Post, Patch, Body, Param } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { VehicleService } from './vehicle.service';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '@water-supply-crm/types';

/**
 * Base Vehicle CRUD (create/update basic fields/deactivate/reactivate).
 * List + detail + profile-enrichment live on VehicleProfileController
 * (also `@Controller('fleet/vehicles')`) — GET /fleet/vehicles already
 * doubles as the vehicle-picker source (§17.3).
 */
@Controller('fleet/vehicles')
export class VehicleController {
  constructor(private readonly vehicleService: VehicleService) {}

  @Post()
  @RequirePermissions('fleet:update')
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 30 } })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateVehicleDto) {
    return this.vehicleService.create(user.vendorId, dto);
  }

  @Patch(':id/basic')
  @RequirePermissions('fleet:update')
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 30 } })
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateVehicleDto) {
    return this.vehicleService.update(user.vendorId, id, dto);
  }

  @Patch(':id/deactivate')
  @RequirePermissions('fleet:update')
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 10 } })
  deactivate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.vehicleService.deactivate(user.vendorId, id);
  }

  @Patch(':id/reactivate')
  @RequirePermissions('fleet:update')
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 10 } })
  reactivate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.vehicleService.reactivate(user.vendorId, id);
  }
}
