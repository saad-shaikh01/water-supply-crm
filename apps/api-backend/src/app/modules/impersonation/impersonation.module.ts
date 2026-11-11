import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuditModule } from '../audit/audit.module';
import { getJwtSecret } from '../auth/jwt-secret';
import { AuthImpersonationController, PlatformImpersonationController } from './impersonation.controller';
import { ImpersonationService } from './impersonation.service';

/** Phase 4 / Track B. Global so the app-level ImpersonationGuard / interceptor can inject the service. */
@Global()
@Module({
  imports: [AuditModule, JwtModule.register({ secret: getJwtSecret() })],
  controllers: [PlatformImpersonationController, AuthImpersonationController],
  providers: [ImpersonationService],
  exports: [ImpersonationService],
})
export class ImpersonationModule {}
