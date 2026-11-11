import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { UserModule } from '../user/user.module';
import { AuthzModule } from '../authz/authz.module';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { getJwtSecret } from './jwt-secret';
import { AuditModule } from '../audit/audit.module';
import { AuthSessionService } from './session/auth-session.service';
import { TwoFactorService } from './two-factor/two-factor.service';
import { AuthSecurityPolicyService } from './security-policy.service';
import { SecurityController } from './security.controller';

@Module({
  imports: [
    UserModule,
    AuthzModule,
    AuditModule,
    PassportModule,
    JwtModule.register({
      secret: getJwtSecret(),
      signOptions: { expiresIn: '1d' },
    }),
  ],
  controllers: [AuthController, SecurityController],
  providers: [AuthService, JwtStrategy, AuthSessionService, TwoFactorService, AuthSecurityPolicyService],
  exports: [AuthService, AuthSessionService, TwoFactorService, AuthSecurityPolicyService],
})
export class AuthModule {}
