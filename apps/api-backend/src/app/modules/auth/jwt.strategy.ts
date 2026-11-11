import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { CacheInvalidationService } from '@water-supply-crm/caching';
import { vendorSuspendedKey } from '../vendor/vendor.service';
import { sessionsValidAfterKey } from './auth.service';
import { userInactiveKey } from '../user/user.service';
import type { AuthUser } from '@water-supply-crm/types';
import { impersonationActiveKey } from '../impersonation/impersonation.service';
import { allowsQueryToken, getJwtSecret } from './jwt-secret';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly cache: CacheInvalidationService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        (req) => {
          // Token via query param ONLY for the SSE stream (EventSource cannot send headers); on every
          // other route a URL-borne token would leak into access logs / Referer headers.
          return allowsQueryToken(req?.path) ? (req?.query?.token as string) : null;
        },
      ]),
      ignoreExpiration: false,
      secretOrKey: getJwtSecret(),
    });
  }

  async validate(payload: any) {
    // If the user belongs to a vendor, check suspension status (Redis lookup — fast)
    if (payload.vendorId) {
      const isSuspended = await this.cache.get<boolean>(
        vendorSuspendedKey(payload.vendorId),
      );
      if (isSuspended) {
        throw new UnauthorizedException(
          'Your account has been suspended. Contact support.',
        );
      }
    }

    // Deactivated after this token was issued? (flag set by UserService.deactivate)
    if (payload.sub && (await this.cache.get<boolean>(userInactiveKey(payload.sub)))) {
      throw new UnauthorizedException('Your account has been deactivated. Contact your administrator.');
    }

    // Impersonation (support) token: fail CLOSED unless the session is still active in Redis
    // (covers exit, revoke, expiry and a Redis flush) and the acting super admin is still active.
    let impersonation: AuthUser['impersonation'];
    if (payload.imp) {
      const imp = payload.imp;
      if (!imp.sid || !imp.actorId || !(await this.cache.get(impersonationActiveKey(imp.sid)))) {
        throw new UnauthorizedException('Support session has ended.');
      }
      if (await this.cache.get<boolean>(userInactiveKey(imp.actorId))) {
        throw new UnauthorizedException('Support session has ended.');
      }
      impersonation = {
        sessionId: imp.sid,
        actorId: imp.actorId,
        actorName: imp.actorName,
        mode: imp.mode === 'SUPPORT' ? 'SUPPORT' : 'READ_ONLY',
        expiresAt: payload.exp ? new Date(payload.exp * 1000).toISOString() : undefined,
      };
    }

    // Sessions revoked after this token was issued? (AuthService.revokeUserSessions)
    if (payload.sub) {
      const validAfter = await this.cache.get<number>(sessionsValidAfterKey(payload.sub));
      if (validAfter && (payload.iat ?? 0) < Math.floor(validAfter / 1000)) {
        throw new UnauthorizedException('Your session has expired. Please sign in again.');
      }
    }

    return {
      ...(impersonation && { impersonation }),
      userId: payload.sub,
      email: payload.email,
      name: payload.name,
      role: payload.role,
      vendorId: payload.vendorId,
      customerId: payload.customerId,
    };
  }
}
