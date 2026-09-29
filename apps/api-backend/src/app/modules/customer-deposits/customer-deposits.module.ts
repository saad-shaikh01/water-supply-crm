import { Module } from '@nestjs/common';
import { CustomerDepositsController } from './customer-deposits.controller';
import { CustomerDepositsService } from './customer-deposits.service';
import { CustomerFinancialAdjustmentModule } from '../customer-financial-adjustment/customer-financial-adjustment.module';

/**
 * Customer Deposits (owner-requested 2026-09-29) — an optional, per-customer
 * refundable CASH/BOTTLE security deposit. See the service's class doc for
 * the ledger-first design. PrismaService and CacheInvalidationService come
 * from the global Database/Caching modules and PermissionService from the
 * @Global AuthzModule; the audit rows are written in-transaction, so
 * AuditModule is not needed. CustomerFinancialAdjustmentModule is imported
 * for `applyToBalance` — Closure Settlement (2026-09-29) cross-posts an
 * OTHER_CREDIT adjustment atomically via CustomerFinancialAdjustmentService.createTx.
 */
@Module({
  imports: [CustomerFinancialAdjustmentModule],
  controllers: [CustomerDepositsController],
  providers: [CustomerDepositsService],
  exports: [CustomerDepositsService],
})
export class CustomerDepositsModule {}
