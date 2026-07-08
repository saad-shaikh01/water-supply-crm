import { Global, Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PermissionService } from './permission.service';
import { AuthzPolicyService } from './authz-policy.service';
import { RoleService } from './role.service';
import { UserPermissionService } from './user-permission.service';
import { PermissionsController } from './permissions.controller';
import { RolesController } from './roles.controller';
import { UserAccessController } from './user-access.controller';
import { PermissionsGuard } from '../../common/guards/permissions.guard';

/**
 * Backend authorization layer (Phase B). PrismaService and CacheInvalidationService
 * come from the global Database/Caching modules; AuditService from AuditModule.
 */
@Global()
@Module({
  imports: [AuditModule],
  controllers: [PermissionsController, RolesController, UserAccessController],
  providers: [PermissionService, AuthzPolicyService, RoleService, UserPermissionService, PermissionsGuard],
  exports: [PermissionService, AuthzPolicyService, PermissionsGuard],
})
export class AuthzModule {}
