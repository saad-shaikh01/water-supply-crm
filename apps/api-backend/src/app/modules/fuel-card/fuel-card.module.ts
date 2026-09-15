import { Module } from '@nestjs/common';
import { FuelCardService } from './fuel-card.service';
import { FuelCardController } from './fuel-card.controller';
import { AuditModule } from '../audit/audit.module';
import { StorageModule } from '../../common/storage/storage.module';

/**
 * Fuel Card Wallet (owner-requested 2026-09-15) — see FuelCardService's class
 * doc comment for the full problem/solution writeup. Exports the service so
 * VanCashLedgerModule could, in principle, read balances without a module
 * cycle; in practice VanCashLedgerService queries `prisma.fuelCardTopUp`
 * directly (same pattern it already uses for OfficeCashRemittance) rather
 * than importing this module.
 */
@Module({
  imports: [AuditModule, StorageModule],
  controllers: [FuelCardController],
  providers: [FuelCardService],
  exports: [FuelCardService],
})
export class FuelCardModule {}
