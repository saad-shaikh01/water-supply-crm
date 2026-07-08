import {
  Controller,
  Delete,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { UserService } from './user.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UserQueryDto } from './dto/user-query.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { AuthenticatedOnly } from '../../common/decorators/authz-markers.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '@water-supply-crm/types';

@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Post()
  @RequirePermissions('users:create')
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 20 } })
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateUserDto) {
    return this.userService.create({
      ...dto,
      vendorId: user.vendorId,
    });
  }

  @Get()
  @RequirePermissions('users:view')
  async findAll(@CurrentUser() user: AuthUser, @Query() query: UserQueryDto) {
    return this.userService.findAllPaginated(user.vendorId, query);
  }

  @Get(':id')
  @RequirePermissions('users:view')
  async findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.userService.findOneByVendor(user.vendorId, id);
  }

  @Patch(':id')
  @RequirePermissions('users:update')
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 20 } })
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.userService.update(user.vendorId, id, dto);
  }

  /** PATCH /users/:id/deactivate — soft-disable (isActive = false), preserves all history */
  @Patch(':id/deactivate')
  @RequirePermissions('users:deactivate')
  async deactivate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.userService.deactivate(user.vendorId, id);
  }

  /** PATCH /users/:id/reactivate — re-enable a previously deactivated user */
  @Patch(':id/reactivate')
  @RequirePermissions('users:restore')
  async reactivate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.userService.reactivate(user.vendorId, id);
  }

  /** PATCH /users/me/change-password — user changes their own password */
  @Patch('me/change-password')
  @AuthenticatedOnly()
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 10 } })
  changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto) {
    return this.userService.changeOwnPassword(user.userId, dto.currentPassword, dto.newPassword);
  }

  /** DELETE /users/:id — permanent delete, blocked if user has any daily sheets */
  @Delete(':id')
  @RequirePermissions('users:delete')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.userService.remove(user.vendorId, id);
  }
}
