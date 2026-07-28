import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UserModule } from '../user/user.module';
import { AuditModule } from '../audit/audit.module';
import { CustomerActivationService } from './customer-activation.service';
import { CustomerActivationController } from './customer-activation.controller';

@Module({
  imports: [AuthModule, UserModule, AuditModule],
  controllers: [CustomerActivationController],
  providers: [CustomerActivationService],
})
export class CustomerActivationModule {}
