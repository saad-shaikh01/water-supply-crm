import { Module } from '@nestjs/common';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { AuditModule } from '../audit/audit.module';

import { PlanLimitModule } from '../billing/plan-limit.module';

@Module({
  imports: [PlanLimitModule, AuditModule],
  controllers: [UserController],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule {}
