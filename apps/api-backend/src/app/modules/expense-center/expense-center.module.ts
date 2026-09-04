import { Module } from '@nestjs/common';
import { ExpenseCenterService } from './expense-center.service';
import { ExpenseCenterController } from './expense-center.controller';

@Module({
  controllers: [ExpenseCenterController],
  providers: [ExpenseCenterService],
})
export class ExpenseCenterModule {}
