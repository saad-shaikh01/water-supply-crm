import { Module } from '@nestjs/common';
import { VanService } from './van.service';
import { VanController } from './van.controller';

import { PlanLimitModule } from '../billing/plan-limit.module';

@Module({
  imports: [PlanLimitModule],
  controllers: [VanController],
  providers: [VanService],
})
export class VanModule {}
