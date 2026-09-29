import { Module } from '@nestjs/common';
import { CustomerDepositsController } from './customer-deposits.controller';
import { CustomerDepositsService } from './customer-deposits.service';

/**
 * Customer Deposits (owner-requested 2026-09-29) — an optional, per-customer
 * refundable CASH/BOTTLE security deposit. See the service's class doc for
 * the ledger-first design. PrismaService and CacheInvalidationService come
 * from the global Database/Caching modules and PermissionService from the
 * @Global AuthzModule; the audit rows are written in-transaction, so
 * AuditModule is not needed.
 */
@Module({
  controllers: [CustomerDepositsController],
  providers: [CustomerDepositsService],
  exports: [CustomerDepositsService],
})
export class CustomerDepositsModule {}
