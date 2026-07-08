import { Controller, Get, Patch, Param, Body } from '@nestjs/common';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '@water-supply-crm/types';
import { UserPermissionService } from './user-permission.service';
import { AssignRoleDto } from './dto/assign-role.dto';
import { UpdateOverridesDto } from './dto/update-overrides.dto';

/**
 * User-scoped access-control endpoints. Shares the /users prefix with UserController
 * but declares distinct sub-routes (:id/role, :id/permissions, :id/overrides) — no
 * route collisions — and uses the permission guard rather than the legacy roles guard.
 */
@Controller('users')
export class UserAccessController {
  constructor(private readonly userPermissions: UserPermissionService) {}

  @Patch(':id/role')
  @RequirePermissions('roles:assign')
  assignRole(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: AssignRoleDto) {
    return this.userPermissions.assignRole(user, id, dto.roleId);
  }

  @Get(':id/permissions')
  @RequirePermissions('users:view')
  effective(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.userPermissions.getEffective(user, id);
  }

  @Patch(':id/overrides')
  @RequirePermissions('roles:manage_overrides')
  setOverrides(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateOverridesDto) {
    return this.userPermissions.setOverrides(user, id, dto);
  }
}
