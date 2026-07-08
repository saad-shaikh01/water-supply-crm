import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
} from '@nestjs/common';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '@water-supply-crm/types';
import { RoleService } from './role.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { CloneRoleDto } from './dto/clone-role.dto';

@Controller('roles')
export class RolesController {
  constructor(private readonly roleService: RoleService) {}

  @Get()
  @RequirePermissions('roles:view')
  list(@CurrentUser() user: AuthUser) {
    return this.roleService.list(user);
  }

  @Post()
  @RequirePermissions('roles:create')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateRoleDto) {
    return this.roleService.create(user, dto);
  }

  @Get(':id')
  @RequirePermissions('roles:view')
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.roleService.findOne(user, id);
  }

  @Patch(':id')
  @RequirePermissions('roles:update')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateRoleDto) {
    return this.roleService.update(user, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('roles:delete')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.roleService.remove(user, id);
  }

  @Post(':id/clone')
  @RequirePermissions('roles:clone')
  clone(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: CloneRoleDto) {
    return this.roleService.clone(user, id, dto);
  }

  @Post(':id/reset')
  @RequirePermissions('roles:reset')
  reset(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.roleService.resetToPreset(user, id);
  }
}
