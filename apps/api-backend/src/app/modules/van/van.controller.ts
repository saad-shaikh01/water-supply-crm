import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { UserRole } from '@prisma/client';
import { VanService } from './van.service';
import { CreateVanDto } from './dto/create-van.dto';
import { UpdateVanDto } from './dto/update-van.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('vans')
@UseGuards(JwtAuthGuard, RolesGuard)
export class VanController {
  constructor(private readonly vanService: VanService) {}

  @Post()
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF)
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 20 } })
  create(@CurrentUser() user: any, @Body() dto: CreateVanDto) {
    return this.vanService.create(user.vendorId, dto);
  }

  @Get()
  findAll(@CurrentUser() user: any, @Query() query: PaginationQueryDto) {
    return this.vanService.findAllPaginated(user.vendorId, query);
  }

  @Get(':id')
  findOne(@CurrentUser() user: any, @Param('id') id: string) {
    return this.vanService.findOne(user.vendorId, id);
  }

  @Patch(':id')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF)
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 20 } })
  update(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: UpdateVanDto,
  ) {
    return this.vanService.update(user.vendorId, id, dto);
  }

  @Patch(':id/deactivate')
  @Roles(UserRole.VENDOR_ADMIN)
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 10 } })
  deactivate(@CurrentUser() user: any, @Param('id') id: string) {
    return this.vanService.deactivate(user.vendorId, id);
  }

  @Patch(':id/reactivate')
  @Roles(UserRole.VENDOR_ADMIN)
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 10 } })
  reactivate(@CurrentUser() user: any, @Param('id') id: string) {
    return this.vanService.reactivate(user.vendorId, id);
  }

  @Delete(':id')
  @Roles(UserRole.VENDOR_ADMIN)
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 10 } })
  remove(@CurrentUser() user: any, @Param('id') id: string) {
    return this.vanService.remove(user.vendorId, id);
  }
}
