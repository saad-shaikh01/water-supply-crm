import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
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
import { WarehouseTransactionQueryDto, RepairBatchQueryDto } from './dto/warehouse-query.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '@water-supply-crm/types';

@Controller('warehouse')
@UseGuards(JwtAuthGuard, RolesGuard)
export class WarehouseController {
  constructor(private readonly warehouse: WarehouseService) {}

  @Get('stock')
  @Roles(UserRole.STAFF, UserRole.VENDOR_ADMIN, UserRole.SUPER_ADMIN)
  getStock(@CurrentUser() user: AuthUser) {
    return this.warehouse.getStock(user.vendorId);
  }

  @Get('universe')
  @Roles(UserRole.STAFF, UserRole.VENDOR_ADMIN, UserRole.SUPER_ADMIN)
  getUniverse(@CurrentUser() user: AuthUser) {
    return this.warehouse.getUniverse(user.vendorId);
  }

  @Get('transactions')
  @Roles(UserRole.STAFF, UserRole.VENDOR_ADMIN, UserRole.SUPER_ADMIN)
  getTransactions(@CurrentUser() user: AuthUser, @Query() query: WarehouseTransactionQueryDto) {
    return this.warehouse.getTransactions(user.vendorId, query);
  }

  @Get('repairs')
  @Roles(UserRole.STAFF, UserRole.VENDOR_ADMIN, UserRole.SUPER_ADMIN)
  getRepairBatches(@CurrentUser() user: AuthUser, @Query() query: RepairBatchQueryDto) {
    return this.warehouse.getRepairBatches(user.vendorId, query);
  }

  @Post('opening-balance')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.SUPER_ADMIN)
  openingBalance(@CurrentUser() user: AuthUser, @Body() dto: OpeningBalanceDto) {
    return this.warehouse.openingBalance(user.vendorId, dto, user.userId);
  }

  @Post('fill-in')
  @Roles(UserRole.STAFF, UserRole.VENDOR_ADMIN, UserRole.SUPER_ADMIN)
  fillIn(@CurrentUser() user: AuthUser, @Body() dto: FillInDto) {
    return this.warehouse.fillIn(user.vendorId, dto, user.userId);
  }

  @Post('refill')
  @Roles(UserRole.STAFF, UserRole.VENDOR_ADMIN, UserRole.SUPER_ADMIN)
  refill(@CurrentUser() user: AuthUser, @Body() dto: RefillDto) {
    return this.warehouse.refill(user.vendorId, dto, user.userId);
  }

  @Post('mark-damaged')
  @Roles(UserRole.STAFF, UserRole.VENDOR_ADMIN, UserRole.SUPER_ADMIN)
  markDamaged(@CurrentUser() user: AuthUser, @Body() dto: MarkDamagedDto) {
    return this.warehouse.markDamaged(user.vendorId, dto, user.userId);
  }

  @Post('mark-leaked')
  @Roles(UserRole.STAFF, UserRole.VENDOR_ADMIN, UserRole.SUPER_ADMIN)
  markLeaked(@CurrentUser() user: AuthUser, @Body() dto: MarkLeakedDto) {
    return this.warehouse.markLeaked(user.vendorId, dto, user.userId);
  }

  @Post('send-repair')
  @Roles(UserRole.STAFF, UserRole.VENDOR_ADMIN, UserRole.SUPER_ADMIN)
  sendRepair(@CurrentUser() user: AuthUser, @Body() dto: SendRepairDto) {
    return this.warehouse.sendRepair(user.vendorId, dto, user.userId);
  }

  @Patch('repairs/:batchId/return')
  @Roles(UserRole.STAFF, UserRole.VENDOR_ADMIN, UserRole.SUPER_ADMIN)
  returnRepair(
    @CurrentUser() user: AuthUser,
    @Param('batchId') batchId: string,
    @Body() dto: ReturnRepairDto,
  ) {
    return this.warehouse.returnRepair(user.vendorId, batchId, dto, user.userId);
  }

  @Post('write-off')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.SUPER_ADMIN)
  writeOff(@CurrentUser() user: AuthUser, @Body() dto: WriteOffDto) {
    return this.warehouse.writeOff(user.vendorId, dto, user.userId);
  }

  @Post('adjustment')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.SUPER_ADMIN)
  adjustment(@CurrentUser() user: AuthUser, @Body() dto: AdjustmentDto) {
    return this.warehouse.adjustment(user.vendorId, dto, user.userId);
  }
}
