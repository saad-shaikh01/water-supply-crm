import {
  Controller,
  Delete,
  Get,
  Post,
  Patch,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { UserRole } from '@prisma/client';
import { UserService } from './user.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Post()
  @Roles(UserRole.VENDOR_ADMIN)
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 20 } })
  async create(@CurrentUser() user: any, @Body() dto: CreateUserDto) {
    return this.userService.create({
      ...dto,
      vendorId: user.vendorId,
    });
  }

  @Get()
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF)
  async findAll(@CurrentUser() user: any) {
    return this.userService.findAllByVendor(user.vendorId);
  }

  @Get(':id')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF)
  async findOne(@CurrentUser() user: any, @Param('id') id: string) {
    return this.userService.findOneByVendor(user.vendorId, id);
  }

  @Patch(':id')
  @Roles(UserRole.VENDOR_ADMIN)
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 20 } })
  async update(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.userService.update(user.vendorId, id, dto);
  }

  /** PATCH /users/:id/deactivate — soft-disable (isActive = false), preserves all history */
  @Patch(':id/deactivate')
  @Roles(UserRole.VENDOR_ADMIN)
  async deactivate(@CurrentUser() user: any, @Param('id') id: string) {
    return this.userService.deactivate(user.vendorId, id);
  }

  /** PATCH /users/:id/reactivate — re-enable a previously deactivated user */
  @Patch(':id/reactivate')
  @Roles(UserRole.VENDOR_ADMIN)
  async reactivate(@CurrentUser() user: any, @Param('id') id: string) {
    return this.userService.reactivate(user.vendorId, id);
  }

  /** DELETE /users/:id — permanent delete, blocked if user has any daily sheets */
  @Delete(':id')
  @Roles(UserRole.VENDOR_ADMIN)
  async remove(@CurrentUser() user: any, @Param('id') id: string) {
    return this.userService.remove(user.vendorId, id);
  }
}
