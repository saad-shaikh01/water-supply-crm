import {
  Controller,
  Delete,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ProductService } from './product.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductQueryDto } from './dto/product-query.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '@water-supply-crm/types';

@Controller('products')
export class ProductController {
  constructor(private readonly productService: ProductService) {}

  @Post()
  @RequirePermissions('products:create')
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 20 } })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateProductDto) {
    return this.productService.create(user.vendorId, dto);
  }

  // Was open to any authenticated user (no @Roles) → now gated by products:view.
  // No HTTP Cache-Control here (was 'private, max-age=300') — see van.controller.ts
  // findAll for why: the browser cache can't be invalidated when a product
  // changes, so pickers kept showing stale entries after an update/toggle.
  @Get()
  @RequirePermissions('products:view')
  findAll(@CurrentUser() user: AuthUser, @Query() query: ProductQueryDto) {
    return this.productService.findAll(user.vendorId, query);
  }

  @Get(':id')
  @RequirePermissions('products:view')
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.productService.findOne(user.vendorId, id);
  }

  @Patch(':id')
  @RequirePermissions('products:update')
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 20 } })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.productService.update(user.vendorId, id, dto);
  }

  // toggle-active shares products:update (was VENDOR_ADMIN-only; see plan §1.4).
  @Patch(':id/toggle-active')
  @RequirePermissions('products:update')
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 20 } })
  toggleActive(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.productService.toggleActive(user.vendorId, id);
  }

  @Delete(':id')
  @RequirePermissions('products:delete')
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 10 } })
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.productService.remove(user.vendorId, id);
  }
}
