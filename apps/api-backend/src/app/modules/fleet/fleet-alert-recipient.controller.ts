import { Controller, Get, Post, Patch, Delete, Body, Param } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { FleetAlertRecipientService } from './fleet-alert-recipient.service';
import { CreateFleetAlertRecipientDto } from './dto/create-fleet-alert-recipient.dto';
import { UpdateFleetAlertRecipientDto } from './dto/update-fleet-alert-recipient.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '@water-supply-crm/types';

@Controller('fleet/alert-recipients')
export class FleetAlertRecipientController {
  constructor(private readonly service: FleetAlertRecipientService) {}

  @Get()
  @RequirePermissions('fleet:manage_alerts')
  list(@CurrentUser() user: AuthUser) {
    return this.service.list(user.vendorId);
  }

  @Post()
  @RequirePermissions('fleet:manage_alerts')
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 20 } })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateFleetAlertRecipientDto) {
    return this.service.create(user, dto);
  }

  @Patch(':id')
  @RequirePermissions('fleet:manage_alerts')
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 20 } })
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateFleetAlertRecipientDto) {
    return this.service.update(user, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('fleet:manage_alerts')
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 10 } })
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user, id);
  }
}
