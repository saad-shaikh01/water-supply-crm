import { Module } from '@nestjs/common';
import { CustomerFinancialAdjustmentController } from './customer-financial-adjustment.controller';
import { CustomerFinancialAdjustmentService } from './customer-financial-adjustment.service';
import { CustomerFinancialAdjustmentTransferController } from './customer-financial-adjustment-transfer.controller';
import { CustomerFinancialAdjustmentTransferService } from './customer-financial-adjustment-transfer.service';

/**
 * Customer Financial Adjustments (owner-approved 2026-09-21) — manual, non-delivery
 * charges / credits / balance transfers posted to the customer ledger. See the
 * services' class docs for the ledger-first design. PrismaService and
 * CacheInvalidationService come from the global Database/Caching modules and
 * PermissionService from the @Global AuthzModule; the audit rows are written
 * in-transaction, so AuditModule is not needed.
 *
 * The transfer controller is listed FIRST: its `transfers/...` routes must be matched
 * before the main controller's dynamic `:id` routes.
 */
@Module({
  controllers: [CustomerFinancialAdjustmentTransferController, CustomerFinancialAdjustmentController],
  providers: [CustomerFinancialAdjustmentService, CustomerFinancialAdjustmentTransferService],
  exports: [CustomerFinancialAdjustmentService, CustomerFinancialAdjustmentTransferService],
})
export class CustomerFinancialAdjustmentModule {}
