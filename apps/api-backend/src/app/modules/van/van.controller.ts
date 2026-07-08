import {
  Controller,
  Get,
  Post,
  Patch,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { VanService } from './van.service';
import { CreateVanDto } from './dto/create-van.dto';
import { UpdateVanDto } from './dto/update-van.dto';
import { UpdateDefaultCrewDto } from './dto/update-default-crew.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '@water-supply-crm/types';

@Controller('vans')
export class VanController {
  constructor(private readonly vanService: VanService) {}

  @Post()
  @RequirePermissions('vans:create')
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 20 } })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateVanDto) {
    return this.vanService.create(user.vendorId, dto);
  }

  // Was open to any authenticated user (no @Roles) → now gated by vans:view.
  @Get()
  @RequirePermissions('vans:view')
  findAll(
    @CurrentUser() user: AuthUser,
    @Query() query: PaginationQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'private, max-age=300');
    return this.vanService.findAllPaginated(user.vendorId, query);
  }

  @Get(':id')
  @RequirePermissions('vans:view')
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.vanService.findOne(user.vendorId, id);
  }

  @Patch(':id')
  @RequirePermissions('vans:update')
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 20 } })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateVanDto,
  ) {
    return this.vanService.update(user.vendorId, id, dto);
  }

  /** PUT /vans/:id/default-crew — full-replace the van's default supporting crew */
  @Put(':id/default-crew')
  @RequirePermissions('vans:manage_crew')
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 20 } })
  updateDefaultCrew(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateDefaultCrewDto,
  ) {
    return this.vanService.updateDefaultCrew(user.vendorId, id, dto);
  }

  @Patch(':id/deactivate')
  @RequirePermissions('vans:deactivate')
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 10 } })
  deactivate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.vanService.deactivate(user.vendorId, id);
  }

  @Patch(':id/reactivate')
  @RequirePermissions('vans:restore')
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 10 } })
  reactivate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.vanService.reactivate(user.vendorId, id);
  }

  @Delete(':id')
  @RequirePermissions('vans:delete')
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 10 } })
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.vanService.remove(user.vendorId, id);
  }
}
