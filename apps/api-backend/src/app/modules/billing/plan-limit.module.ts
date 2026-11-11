import { Module } from '@nestjs/common';
import { PlanLimitService } from './plan-limit.service';

/** Lightweight module so Customer/User/Van/Import modules can enforce limits without importing all of billing. */
@Module({
  providers: [PlanLimitService],
  exports: [PlanLimitService],
})
export class PlanLimitModule {}
