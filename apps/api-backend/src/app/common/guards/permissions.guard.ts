import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { hasPermission } from '@water-supply-crm/authz';
import {
  PERMISSIONS_KEY,
  type RequiredPermissionsMeta,
} from '../decorators/require-permissions.decorator';
import { PUBLIC_KEY } from '../decorators/public.decorator';
import {
  AUTHENTICATED_ONLY_KEY,
  REQUIRE_ROLE_KEY,
} from '../decorators/authz-markers.decorator';
import { PermissionService } from '../../modules/authz/permission.service';

/**
 * The single authorization guard. Designed to run globally (Phase C) as deny-by-default:
 * a route with NO authorization marker is denied. Markers, in precedence order:
 *
 *   @Public()              → allow (unauthenticated; JwtAuthGuard also skips it)
 *   @AuthenticatedOnly()   → any authenticated user (self-service)
 *   @RequireSuperAdmin()   → platform surface (role check; outside the vendor catalog)
 *   @RequireCustomer()     → customer-portal surface (role check)
 *   @RequirePermissions()  → vendor permission check (all / any)
 *   (none)                 → DENY
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissionService: PermissionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];

    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const requireUser = () => {
      if (!user?.userId) throw new UnauthorizedException();
    };

    if (this.reflector.getAllAndOverride<boolean>(AUTHENTICATED_ONLY_KEY, targets)) {
      requireUser();
      return true;
    }

    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(REQUIRE_ROLE_KEY, targets);
    if (requiredRoles && requiredRoles.length > 0) {
      requireUser();
      if (!requiredRoles.includes(user.role)) {
        throw new ForbiddenException('You do not have access to this resource.');
      }
      return true;
    }

    const meta = this.reflector.getAllAndOverride<RequiredPermissionsMeta>(
      PERMISSIONS_KEY,
      targets,
    );
    if (meta && meta.permissions.length > 0) {
      requireUser();
      const effective = new Set(await this.permissionService.getEffectivePermissions(user.userId));
      const granted =
        meta.mode === 'any'
          ? meta.permissions.some((p) => hasPermission(effective, p))
          : meta.permissions.every((p) => hasPermission(effective, p));
      if (!granted) {
        throw new ForbiddenException('You do not have permission to perform this action.');
      }
      return true;
    }

    // Deny-by-default: no authorization marker means the route is not authorized.
    throw new ForbiddenException('This endpoint has no authorization policy.');
  }
}
