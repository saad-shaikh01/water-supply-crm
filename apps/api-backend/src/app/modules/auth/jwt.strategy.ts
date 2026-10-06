import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { CacheInvalidationService } from '@water-supply-crm/caching';
import { vendorSuspendedKey } from '../vendor/vendor.service';
import { userInactiveKey } from '../user/user.service';
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

    return {
      userId: payload.sub,
      email: payload.email,
      name: payload.name,
      role: payload.role,
      vendorId: payload.vendorId,
      customerId: payload.customerId,
    };
  }
}
