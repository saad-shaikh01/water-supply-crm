import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { RouteService } from './route.service';
import { CreateRouteDto } from './dto/create-route.dto';
import { UpdateRouteDto } from './dto/update-route.dto';
import { RouteQueryDto } from './dto/route-query.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '@water-supply-crm/types';

@Controller('routes')
export class RouteController {
  constructor(private readonly routeService: RouteService) {}

  @Post()
  @RequirePermissions('routes:create')
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 20 } })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateRouteDto) {
    return this.routeService.create(user.vendorId, dto);
  }

  // Was open to any authenticated user (no @Roles) → now gated by routes:view.
  @Get()
  @RequirePermissions('routes:view')
  findAll(
    @CurrentUser() user: AuthUser,
    @Query() query: RouteQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'private, max-age=300');
    return this.routeService.findAllPaginated(user.vendorId, query);
  }

  @Get(':id')
  @RequirePermissions('routes:view')
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.routeService.findOne(user.vendorId, id);
  }

  @Patch(':id')
  @RequirePermissions('routes:update')
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 20 } })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateRouteDto,
  ) {
    return this.routeService.update(user.vendorId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('routes:delete')
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 10 } })
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.routeService.remove(user.vendorId, id);
  }
}
