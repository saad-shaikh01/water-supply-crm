import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { WarehouseService } from './warehouse.service';
import { FillInDto } from './dto/fill-in.dto';
import { OpeningBalanceDto } from './dto/opening-balance.dto';
import { RefillDto } from './dto/refill.dto';
import { MarkDamagedDto } from './dto/mark-damaged.dto';
import { MarkLeakedDto } from './dto/mark-leaked.dto';
import { SendRepairDto } from './dto/send-repair.dto';
import { ReturnRepairDto } from './dto/return-repair.dto';
import { WriteOffDto } from './dto/write-off.dto';
import { AdjustmentDto } from './dto/adjustment.dto';
import { WarehouseTransactionQueryDto, RepairBatchQueryDto, WarehouseSummaryDto } from './dto/warehouse-query.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '@water-supply-crm/types';

@Controller('warehouse')
export class WarehouseController {
  constructor(private readonly warehouse: WarehouseService) {}

  // ── Reads → inventory:view ──────────────────────────────────────────────
  @Get('stock')
  @RequirePermissions('inventory:view')
  getStock(@CurrentUser() user: AuthUser) {
    return this.warehouse.getStock(user.vendorId);
  }

  @Get('universe')
  @RequirePermissions('inventory:view')
  getUniverse(@CurrentUser() user: AuthUser) {
    return this.warehouse.getUniverse(user.vendorId);
  }

  @Get('transactions')
  @RequirePermissions('inventory:view')
  getTransactions(@CurrentUser() user: AuthUser, @Query() query: WarehouseTransactionQueryDto) {
    return this.warehouse.getTransactions(user.vendorId, query);
  }

  @Get('repairs')
  @RequirePermissions('inventory:view')
  getRepairBatches(@CurrentUser() user: AuthUser, @Query() query: RepairBatchQueryDto) {
    return this.warehouse.getRepairBatches(user.vendorId, query);
  }

  @Get('summary')
  @RequirePermissions('inventory:view')
  getSummary(@CurrentUser() user: AuthUser, @Query() dto: WarehouseSummaryDto) {
    return this.warehouse.getSummary(user.vendorId, dto);
  }

  // ── Stock movements ─────────────────────────────────────────────────────
  // opening-balance sets absolute quantities (was VENDOR_ADMIN-only, like adjustment)
  // → inventory:adjust, NOT add_stock, so STAFF/loader don't inherit it.
  @Post('opening-balance')
  @RequirePermissions('inventory:adjust')
  openingBalance(@CurrentUser() user: AuthUser, @Body() dto: OpeningBalanceDto) {
    return this.warehouse.openingBalance(user.vendorId, dto, user.userId);
  }

  @Post('fill-in')
  @RequirePermissions('inventory:add_stock')
  fillIn(@CurrentUser() user: AuthUser, @Body() dto: FillInDto) {
    return this.warehouse.fillIn(user.vendorId, dto, user.userId);
  }

  @Post('refill')
  @RequirePermissions('inventory:add_stock')
  refill(@CurrentUser() user: AuthUser, @Body() dto: RefillDto) {
    return this.warehouse.refill(user.vendorId, dto, user.userId);
  }

  @Post('mark-damaged')
  @RequirePermissions('inventory:mark_damaged')
  markDamaged(@CurrentUser() user: AuthUser, @Body() dto: MarkDamagedDto) {
    return this.warehouse.markDamaged(user.vendorId, dto, user.userId);
  }

  @Post('mark-leaked')
  @RequirePermissions('inventory:mark_damaged')
  markLeaked(@CurrentUser() user: AuthUser, @Body() dto: MarkLeakedDto) {
    return this.warehouse.markLeaked(user.vendorId, dto, user.userId);
  }

  @Post('send-repair')
  @RequirePermissions('inventory:manage_repairs')
  sendRepair(@CurrentUser() user: AuthUser, @Body() dto: SendRepairDto) {
    return this.warehouse.sendRepair(user.vendorId, dto, user.userId);
  }

  @Patch('repairs/:batchId/return')
  @RequirePermissions('inventory:manage_repairs')
  returnRepair(
    @CurrentUser() user: AuthUser,
    @Param('batchId') batchId: string,
    @Body() dto: ReturnRepairDto,
  ) {
    return this.warehouse.returnRepair(user.vendorId, batchId, dto, user.userId);
  }

  // write-off + adjustment stay VENDOR_ADMIN-level (manager holds neither perm).
  @Post('write-off')
  @RequirePermissions('inventory:write_off')
  writeOff(@CurrentUser() user: AuthUser, @Body() dto: WriteOffDto) {
    return this.warehouse.writeOff(user.vendorId, dto, user.userId);
  }

  @Post('adjustment')
  @RequirePermissions('inventory:adjust')
  adjustment(@CurrentUser() user: AuthUser, @Body() dto: AdjustmentDto) {
    return this.warehouse.adjustment(user.vendorId, dto, user.userId);
  }
}
