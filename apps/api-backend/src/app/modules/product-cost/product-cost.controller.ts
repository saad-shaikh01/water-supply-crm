import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ProductCostService } from './product-cost.service';
import { CreateProductCostDto } from './dto/create-product-cost.dto';
import { EditProductCostDto } from './dto/edit-product-cost.dto';
import { VoidProductCostDto } from './dto/void-product-cost.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '@water-supply-crm/types';

/**
 * Historical Product Cost & COGS (docs/features/product-cost-history-and-cogs.md
 * §4/§8). Gated by the new `product_costs:view` / `product_costs:manage`
 * permissions — added to the RBAC catalog by a companion change; the string
 * literals here are independent of that file.
 */
@Controller('product-costs')
export class ProductCostController {
  constructor(private readonly productCosts: ProductCostService) {}

  /** POST /product-costs — Add / backdated-insert (design doc §4.1). */
  @Post()
  @RequirePermissions('product_costs:manage')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateProductCostDto) {
    return this.productCosts.create(user, dto);
  }

  /** GET /product-costs/product/:productId — full history, most recent first. */
  @Get('product/:productId')
  @RequirePermissions('product_costs:view')
  listHistory(@CurrentUser() user: AuthUser, @Param('productId') productId: string) {
    return this.productCosts.listHistory(user, productId);
  }

  /** PATCH /product-costs/:id — Controlled Edit, `costPerUnit` only (design doc §4.4). */
  @Patch(':id')
  @RequirePermissions('product_costs:manage')
  edit(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: EditProductCostDto) {
    return this.productCosts.editCostPerUnit(user, id, dto);
  }

  /** POST /product-costs/:id/void — Void the current row (design doc §4.3). */
  @Post(':id/void')
  @RequirePermissions('product_costs:manage')
  void(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: VoidProductCostDto) {
    return this.productCosts.voidCurrentRow(user, id, dto);
  }
}
