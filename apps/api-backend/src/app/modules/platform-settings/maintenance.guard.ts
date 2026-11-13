import { CanActivate, ExecutionContext, HttpException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { isMaintenanceExemptPath, MAINTENANCE_EXEMPT_KEY } from './maintenance-exempt.decorator';
import { PlatformSettingsService } from './platform-settings.service';

/**
 * Global guard, registered AFTER JwtAuthGuard so `req.user` is populated. When maintenance is ON,
 * everything except SUPER_ADMIN and exempt routes gets 503 MAINTENANCE_MODE.
 * Fails open if the settings cannot be read (the service already falls back to defaults).
 */
@Injectable()
export class MaintenanceGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly settings: PlatformSettingsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const exempt = this.reflector.getAllAndOverride<boolean>(MAINTENANCE_EXEMPT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (exempt) return true;
    const req = context.switchToHttp().getRequest();
    if (isMaintenanceExemptPath(req.originalUrl ?? req.url ?? '')) return true;

    const values = await this.settings.getAll();
    if (values['maintenance.enabled'] !== true) return true;
    if (req.user?.role === UserRole.SUPER_ADMIN) return true;

    const res = context.switchToHttp().getResponse();
    res.setHeader?.('Retry-After', '120');
    throw new HttpException(
      {
        statusCode: 503,
        code: 'MAINTENANCE_MODE',
        message: (values['maintenance.message'] as string) || 'The platform is under maintenance. Please try again shortly.',
        eta: (values['maintenance.eta'] as string | null) ?? null,
      },
      503,
    );
  }
}
