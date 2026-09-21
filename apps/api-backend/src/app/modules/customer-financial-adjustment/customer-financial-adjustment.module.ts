import { Module } from '@nestjs/common';
import { CustomerFinancialAdjustmentController } from './customer-financial-adjustment.controller';
import { CustomerFinancialAdjustmentService } from './customer-financial-adjustment.service';

/**
 * Customer Financial Adjustments (owner-approved 2026-09-21) — manual, non-delivery
 * charges / credits posted to the customer ledger. See the service's class doc for
 * the ledger-first design. PrismaService and CacheInvalidationService come from the
 * global Database/Caching modules and PermissionService from the @Global AuthzModule;
 * the audit row is written in-transaction, so AuditModule is not needed.
 */
@Module({
  controllers: [CustomerFinancialAdjustmentController],
  providers: [CustomerFinancialAdjustmentService],
  exports: [CustomerFinancialAdjustmentService],
})
export class CustomerFinancialAdjustmentModule {}
