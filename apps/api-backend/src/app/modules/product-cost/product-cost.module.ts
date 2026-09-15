import { Module } from '@nestjs/common';
import { ProductCostService } from './product-cost.service';
import { ProductCostController } from './product-cost.controller';

/**
 * Historical Product Cost & COGS (docs/features/product-cost-history-and-cogs.md).
 * The `ProductCost` versioned-rate table + Add/Controlled-Edit/Void mutation
 * paths. COGS itself is computed at read time by the Analytics module, which
 * depends on `ProductCostService` being exported here.
 */
@Module({
  controllers: [ProductCostController],
  providers: [ProductCostService],
  exports: [ProductCostService],
})
export class ProductCostModule {}
