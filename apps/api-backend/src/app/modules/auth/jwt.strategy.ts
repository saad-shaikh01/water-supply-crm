import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { CacheInvalidationService } from '@water-supply-crm/caching';
import { vendorSuspendedKey } from '../vendor/vendor.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly cache: CacheInvalidationService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        (req) => {
          // Allow token via query param for SSE (EventSource)
          return req?.query?.token as string;
        },
      ]),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || 'super-secret-key',
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
