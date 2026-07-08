import { Controller, Get } from '@nestjs/common';
import { PERMISSION_GROUPS } from '@water-supply-crm/authz';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';

/**
 * Exposes the frozen permission catalog (grouped, with page flags + labels) for the
 * permission-management UI. Static data — the client never hardcodes the permission list.
 */
@Controller('permissions')
export class PermissionsController {
  @Get()
  @RequirePermissions('roles:view')
  getCatalog() {
    return { groups: PERMISSION_GROUPS };
  }
}
