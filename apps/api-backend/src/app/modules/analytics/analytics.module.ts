import { Module } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { ProfitLossService } from './profit-loss.service';
import { AnalyticsController } from './analytics.controller';
import { VanCashLedgerModule } from '../van-cash-ledger/van-cash-ledger.module';

@Module({
  imports: [VanCashLedgerModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService, ProfitLossService],
})
export class AnalyticsModule {}
