import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '@water-supply-crm/database';
import { QUEUE_NAMES, JOB_NAMES } from '@water-supply-crm/queue';
import { Prisma, WarehouseTransactionType } from '@prisma/client';
import { FillInDto } from './dto/fill-in.dto';
import { OpeningBalanceDto } from './dto/opening-balance.dto';
import { RefillDto } from './dto/refill.dto';
import { MarkDamagedDto } from './dto/mark-damaged.dto';
import { MarkLeakedDto } from './dto/mark-leaked.dto';
import { SendRepairDto } from './dto/send-repair.dto';
import { ReturnRepairDto } from './dto/return-repair.dto';
import { WriteOffDto } from './dto/write-off.dto';
import { AdjustmentDto } from './dto/adjustment.dto';
import { UpdateAutoRefillConfigDto } from './dto/update-auto-refill-config.dto';
import { WarehouseTransactionQueryDto, RepairBatchQueryDto, WarehouseSummaryDto } from './dto/warehouse-query.dto';

// Runs 10 min after daily sheet auto-generation (00:05 Asia/Karachi, see
// AUTO_GENERATE_CRON in daily-sheet.service.ts) so the night's check-ins are
// all in before the sweep runs.
const AUTO_REFILL_CRON = '15 0 * * *';
const AUTO_REFILL_TZ = 'Asia/Karachi';
const AUTO_REFILL_JOB_ID = 'warehouse-auto-refill';

@Injectable()
export class WarehouseService implements OnModuleInit {
  private readonly logger = new Logger(WarehouseService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_NAMES.WAREHOUSE_AUTO_REFILL)
    private readonly refillQueue: Queue,
  ) {}

  async onModuleInit() {
    try {
      const nextJob = await this.refillQueue.upsertJobScheduler(
        AUTO_REFILL_JOB_ID,
        { pattern: AUTO_REFILL_CRON, tz: AUTO_REFILL_TZ },
        {
          name: JOB_NAMES.AUTO_REFILL_EMPTY_BOTTLES,
          opts: { removeOnComplete: 30, removeOnFail: 20 },
        },
      );
      const nextRun = nextJob
        ? new Date(nextJob.timestamp + (nextJob.delay ?? 0)).toISOString()
        : 'unknown';
      this.logger.log(
        `Warehouse auto-refill scheduled (${AUTO_REFILL_CRON} ${AUTO_REFILL_TZ}) — next run at ${nextRun}`,
      );
    } catch (err) {
      this.logger.error(
        `Failed to schedule warehouse auto-refill: ${(err as Error)?.message ?? String(err)}`,
        (err as Error)?.stack,
      );
    }
  }

  // ─── Read ────────────────────────────────────────────────────────────────

  async getStock(vendorId: string) {
    const stocks = await this.prisma.warehouseStock.findMany({
      where: { vendorId },
      include: {
        product: { select: { id: true, name: true, basePrice: true, isActive: true } },
      },
      orderBy: { product: { name: 'asc' } },
    });
    return stocks;
  }

  async getUniverse(vendorId: string) {
    // Warehouse totals
    const stocks = await this.prisma.warehouseStock.findMany({
      where: { vendorId },
      include: { product: { select: { id: true, name: true } } },
    });

    const warehouseFilled = stocks.reduce((s, r) => s + r.filledCount, 0);
    const warehouseEmpty = stocks.reduce((s, r) => s + r.emptyCount, 0);
    const warehouseDamaged = stocks.reduce((s, r) => s + r.damagedCount, 0);
    const warehouseLeaked = stocks.reduce((s, r) => s + r.leakedCount, 0);
    const warehouseInRepair = stocks.reduce((s, r) => s + r.inRepairCount, 0);

    // Repair batches in transit
    const repairBatchesInTransit = await this.prisma.repairBatch.aggregate({
      where: { vendorId, status: { in: ['SENT', 'PARTIALLY_RETURNED'] } },
      _sum: { bottlesSent: true, bottlesReturned: true },
    });
    const repairInTransit =
      (repairBatchesInTransit._sum.bottlesSent ?? 0) -
      (repairBatchesInTransit._sum.bottlesReturned ?? 0);

    // Vans in active trips (loaded but not yet checked in)
    const activeLoads = await this.prisma.dailySheetLoad.findMany({
      where: { endedAt: null, dailySheet: { vendorId } },
    });
    const vansInTransit = activeLoads.reduce(
      (s, l) => s + l.loadedFilled - l.returnedFilled,
      0,
    );

    // Customer wallet total
    const walletAgg = await this.prisma.bottleWallet.aggregate({
      where: { customer: { vendorId, isActive: true } },
      _sum: { balance: true },
    });
    const customersWalletTotal = walletAgg._sum.balance ?? 0;

    const grandTotal =
      warehouseFilled +
      warehouseEmpty +
      warehouseDamaged +
      warehouseLeaked +
      warehouseInRepair +
      repairInTransit +
      vansInTransit +
      customersWalletTotal;

    return {
      warehouseFilled,
      warehouseEmpty,
      warehouseDamaged,
      warehouseLeaked,
      warehouseInRepair,
      repairBatchesInTransit: repairInTransit,
      vansInTransit,
      customersWalletTotal,
      grandTotal,
      byProduct: stocks,
    };
  }

  async getTransactions(vendorId: string, query: WarehouseTransactionQueryDto) {
    const { page = 1, limit = 20, productId, type, dateFrom, dateTo } = query;
    const where: Prisma.WarehouseTransactionWhereInput = { vendorId };
    if (productId) where.productId = productId;
    if (type) where.type = type;
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = new Date(dateFrom);
      if (dateTo) where.createdAt.lte = new Date(dateTo);
    }

    const [data, total] = await Promise.all([
      this.prisma.warehouseTransaction.findMany({
        where,
        include: {
          product: { select: { id: true, name: true } },
          createdBy: { select: { id: true, name: true, role: true } },
          repairBatch: { select: { id: true, shopName: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.warehouseTransaction.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async getRepairBatches(vendorId: string, query: RepairBatchQueryDto) {
    const { page = 1, limit = 20, productId, status } = query;
    const where: Prisma.RepairBatchWhereInput = { vendorId };
    if (productId) where.productId = productId;
    if (status) where.status = status as any;

    const [data, total] = await Promise.all([
      this.prisma.repairBatch.findMany({
        where,
        include: {
          product: { select: { id: true, name: true } },
          createdBy: { select: { id: true, name: true } },
        },
        orderBy: { sentAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.repairBatch.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async getSummary(vendorId: string, dto: WarehouseSummaryDto) {
    const where: Prisma.WarehouseTransactionWhereInput = { vendorId };
    if (dto.productId) where.productId = dto.productId;
    if (dto.dateFrom || dto.dateTo) {
      where.createdAt = {};
      if (dto.dateFrom) (where.createdAt as any).gte = new Date(dto.dateFrom);
      if (dto.dateTo) {
        const end = new Date(dto.dateTo);
        end.setHours(23, 59, 59, 999);
        (where.createdAt as any).lte = end;
      }
    }

    const transactions = await this.prisma.warehouseTransaction.findMany({
      where,
      orderBy: { createdAt: 'asc' },
    });

    const getPeriodKey = (date: Date): string => {
      if (dto.groupBy === 'week') {
        const d = new Date(date);
        const day = d.getDay() || 7;
        d.setDate(d.getDate() + 4 - day);
        const yearStart = new Date(d.getFullYear(), 0, 1);
        const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
        return `${d.getFullYear()}-W${String(weekNo).padStart(2, '0')}`;
      }
      return date.toISOString().slice(0, 7);
    };

    type PeriodRow = {
      period: string;
      filledIn: number;
      sentToVans: number;
      returnedFilled: number;
      refilled: number;
      emptiesCollected: number;
      damagedTotal: number;
      leakedTotal: number;
      sentForRepair: number;
      returnedFromRepair: number;
      writtenOff: number;
    };

    const periodMap = new Map<string, PeriodRow>();

    const getOrInit = (key: string): PeriodRow => {
      if (!periodMap.has(key)) {
        periodMap.set(key, {
          period: key,
          filledIn: 0, sentToVans: 0, returnedFilled: 0, refilled: 0,
          emptiesCollected: 0, damagedTotal: 0, leakedTotal: 0,
          sentForRepair: 0, returnedFromRepair: 0, writtenOff: 0,
        });
      }
      return periodMap.get(key)!;
    };

    for (const tx of transactions) {
      const row = getOrInit(getPeriodKey(tx.createdAt));
      switch (tx.type) {
        case 'FILL_IN':
          row.filledIn += tx.filledDelta;
          break;
        case 'OPENING_BALANCE':
          row.filledIn += tx.filledDelta; // filled portion counts as stock arriving
          break;
        case 'LOAD_OUT':
          row.sentToVans += Math.abs(tx.filledDelta);
          break;
        case 'CHECK_IN_FILLED':
          row.returnedFilled += tx.filledDelta;
          break;
        case 'REFILL':
          row.refilled += tx.filledDelta;
          break;
        case 'CHECK_IN_EMPTY':
          row.emptiesCollected += tx.emptyDelta;
          break;
        case 'MARK_DAMAGED':
        case 'CHECK_IN_DAMAGED':
          row.damagedTotal += tx.damagedDelta;
          break;
        case 'MARK_LEAKED':
        case 'CHECK_IN_LEAKED':
          row.leakedTotal += tx.leakedDelta;
          break;
        case 'SEND_REPAIR':
          row.sentForRepair += tx.repairDelta;
          break;
        case 'RETURN_REPAIR':
          row.returnedFromRepair += tx.emptyDelta;
          break;
        case 'WRITE_OFF':
          row.writtenOff +=
            Math.abs(tx.damagedDelta) +
            Math.abs(tx.leakedDelta) +
            Math.abs(tx.repairDelta);
          break;
        // ADJUSTMENT, DISCREPANCY_ADJUST: omitted from summary rows
      }
    }

    const rows = Array.from(periodMap.values()).sort((a, b) =>
      a.period.localeCompare(b.period),
    );

    const zero: PeriodRow = {
      period: 'TOTAL', filledIn: 0, sentToVans: 0, returnedFilled: 0, refilled: 0,
      emptiesCollected: 0, damagedTotal: 0, leakedTotal: 0, sentForRepair: 0,
      returnedFromRepair: 0, writtenOff: 0,
    };
    const totals = rows.reduce((acc, r) => ({
      ...acc,
      filledIn: acc.filledIn + r.filledIn,
      sentToVans: acc.sentToVans + r.sentToVans,
      returnedFilled: acc.returnedFilled + r.returnedFilled,
      refilled: acc.refilled + r.refilled,
      emptiesCollected: acc.emptiesCollected + r.emptiesCollected,
      damagedTotal: acc.damagedTotal + r.damagedTotal,
      leakedTotal: acc.leakedTotal + r.leakedTotal,
      sentForRepair: acc.sentForRepair + r.sentForRepair,
      returnedFromRepair: acc.returnedFromRepair + r.returnedFromRepair,
      writtenOff: acc.writtenOff + r.writtenOff,
    }), zero);

    return { rows, totals, groupBy: dto.groupBy ?? 'month' };
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private async getOrCreateStock(
    vendorId: string,
    productId: string,
    tx: Prisma.TransactionClient,
  ) {
    let stock = await tx.warehouseStock.findUnique({
      where: { vendorId_productId: { vendorId, productId } },
    });
    if (!stock) {
      stock = await tx.warehouseStock.create({
        data: { vendorId, productId },
      });
    }
    return stock;
  }

  private async applyDeltas(
    vendorId: string,
    productId: string,
    deltas: {
      filledDelta?: number;
      emptyDelta?: number;
      damagedDelta?: number;
      leakedDelta?: number;
      repairDelta?: number;
    },
    type: WarehouseTransactionType,
    opts: {
      notes?: string;
      createdById?: string;
      dailySheetId?: string;
      repairBatchId?: string;
    },
    tx: Prisma.TransactionClient,
  ) {
    const stock = await this.getOrCreateStock(vendorId, productId, tx);

    const newFilled = stock.filledCount + (deltas.filledDelta ?? 0);
    const newEmpty = stock.emptyCount + (deltas.emptyDelta ?? 0);
    const newDamaged = stock.damagedCount + (deltas.damagedDelta ?? 0);
    const newLeaked = stock.leakedCount + (deltas.leakedDelta ?? 0);
    const newRepair = stock.inRepairCount + (deltas.repairDelta ?? 0);

    if (newFilled < 0) throw new BadRequestException('Insufficient filled stock');
    if (newEmpty < 0) throw new BadRequestException('Insufficient empty stock');
    if (newDamaged < 0) throw new BadRequestException('Insufficient damaged stock');
    if (newLeaked < 0) throw new BadRequestException('Insufficient leaked stock');
    if (newRepair < 0) throw new BadRequestException('Insufficient in-repair stock');

    await tx.warehouseStock.update({
      where: { vendorId_productId: { vendorId, productId } },
      data: {
        filledCount: newFilled,
        emptyCount: newEmpty,
        damagedCount: newDamaged,
        leakedCount: newLeaked,
        inRepairCount: newRepair,
      },
    });

    await tx.warehouseTransaction.create({
      data: {
        vendorId,
        productId,
        type,
        filledDelta: deltas.filledDelta ?? 0,
        emptyDelta: deltas.emptyDelta ?? 0,
        damagedDelta: deltas.damagedDelta ?? 0,
        leakedDelta: deltas.leakedDelta ?? 0,
        repairDelta: deltas.repairDelta ?? 0,
        notes: opts.notes,
        createdById: opts.createdById,
        dailySheetId: opts.dailySheetId,
        repairBatchId: opts.repairBatchId,
      },
    });
  }

  // ─── Manual operations ────────────────────────────────────────────────────

  async openingBalance(vendorId: string, dto: OpeningBalanceDto, userId: string) {
    await this.prisma.$transaction(async (tx) => {
      const stock = await tx.warehouseStock.findUnique({
        where: { vendorId_productId: { vendorId, productId: dto.productId } },
      });
      if (stock && (stock.filledCount + stock.emptyCount + stock.damagedCount + stock.leakedCount + stock.inRepairCount) > 0) {
        throw new BadRequestException('Opening balance can only be set when current stock is zero. Use adjustment instead.');
      }

      if (!stock) {
        await tx.warehouseStock.create({
          data: {
            vendorId,
            productId: dto.productId,
            filledCount: dto.filledCount,
            emptyCount: dto.emptyCount,
            damagedCount: dto.damagedCount,
            leakedCount: dto.leakedCount,
          },
        });
      } else {
        await tx.warehouseStock.update({
          where: { vendorId_productId: { vendorId, productId: dto.productId } },
          data: {
            filledCount: dto.filledCount,
            emptyCount: dto.emptyCount,
            damagedCount: dto.damagedCount,
            leakedCount: dto.leakedCount,
          },
        });
      }

      await tx.warehouseTransaction.create({
        data: {
          vendorId,
          productId: dto.productId,
          type: WarehouseTransactionType.OPENING_BALANCE,
          filledDelta: dto.filledCount,
          emptyDelta: dto.emptyCount,
          damagedDelta: dto.damagedCount,
          leakedDelta: dto.leakedCount,
          notes: dto.notes,
          createdById: userId,
        },
      });
    });
  }

  async fillIn(vendorId: string, dto: FillInDto, userId: string) {
    await this.prisma.$transaction(async (tx) => {
      await this.applyDeltas(
        vendorId,
        dto.productId,
        { filledDelta: dto.quantity },
        WarehouseTransactionType.FILL_IN,
        { notes: dto.notes, createdById: userId },
        tx,
      );
    });
  }

  async refill(vendorId: string, dto: RefillDto, userId: string) {
    await this.prisma.$transaction(async (tx) => {
      await this.applyDeltas(
        vendorId,
        dto.productId,
        { emptyDelta: -dto.quantity, filledDelta: dto.quantity },
        WarehouseTransactionType.REFILL,
        { notes: dto.notes, createdById: userId },
        tx,
      );
    });
  }

  async markDamaged(vendorId: string, dto: MarkDamagedDto, userId: string) {
    const deltas =
      dto.fromStock === 'empty'
        ? { emptyDelta: -dto.quantity, damagedDelta: dto.quantity }
        : { filledDelta: -dto.quantity, damagedDelta: dto.quantity };

    await this.prisma.$transaction(async (tx) => {
      await this.applyDeltas(
        vendorId,
        dto.productId,
        deltas,
        WarehouseTransactionType.MARK_DAMAGED,
        { notes: dto.notes, createdById: userId },
        tx,
      );
    });
  }

  async markLeaked(vendorId: string, dto: MarkLeakedDto, userId: string) {
    const deltas =
      dto.fromStock === 'empty'
        ? { emptyDelta: -dto.quantity, leakedDelta: dto.quantity }
        : { filledDelta: -dto.quantity, leakedDelta: dto.quantity };

    await this.prisma.$transaction(async (tx) => {
      await this.applyDeltas(
        vendorId,
        dto.productId,
        deltas,
        WarehouseTransactionType.MARK_LEAKED,
        { notes: dto.notes, createdById: userId },
        tx,
      );
    });
  }

  async sendRepair(vendorId: string, dto: SendRepairDto, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const deltas =
        dto.fromStock === 'damaged'
          ? { damagedDelta: -dto.quantity, repairDelta: dto.quantity }
          : { emptyDelta: -dto.quantity, repairDelta: dto.quantity };

      // Create repair batch first to get its id
      const batch = await tx.repairBatch.create({
        data: {
          vendorId,
          productId: dto.productId,
          shopName: dto.shopName,
          bottlesSent: dto.quantity,
          notes: dto.notes,
          createdById: userId,
        },
      });

      await this.applyDeltas(
        vendorId,
        dto.productId,
        deltas,
        WarehouseTransactionType.SEND_REPAIR,
        { notes: dto.notes, createdById: userId, repairBatchId: batch.id },
        tx,
      );

      return batch;
    });
  }

  async returnRepair(vendorId: string, batchId: string, dto: ReturnRepairDto, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const batch = await tx.repairBatch.findFirst({
        where: { id: batchId, vendorId },
      });
      if (!batch) throw new NotFoundException('Repair batch not found');
      if (batch.status === 'COMPLETED') throw new BadRequestException('Repair batch already completed');

      const totalProcessed = batch.bottlesReturned + dto.bottlesReturned + dto.bottlesWrittenOff;
      if (totalProcessed > batch.bottlesSent) {
        throw new BadRequestException('Returned + written-off exceeds bottles sent');
      }

      const newStatus = totalProcessed >= batch.bottlesSent ? 'COMPLETED' : 'PARTIALLY_RETURNED';

      await tx.repairBatch.update({
        where: { id: batchId },
        data: {
          bottlesReturned: { increment: dto.bottlesReturned },
          bottlesWrittenOff: { increment: dto.bottlesWrittenOff },
          status: newStatus as any,
          returnedAt: newStatus === 'COMPLETED' ? new Date() : undefined,
        },
      });

      // Repaired bottles go back to emptyCount; written-off just leave inRepair
      if (dto.bottlesReturned > 0) {
        await this.applyDeltas(
          vendorId,
          batch.productId,
          { repairDelta: -dto.bottlesReturned, emptyDelta: dto.bottlesReturned },
          WarehouseTransactionType.RETURN_REPAIR,
          { notes: dto.notes, createdById: userId, repairBatchId: batchId },
          tx,
        );
      }
      if (dto.bottlesWrittenOff > 0) {
        await this.applyDeltas(
          vendorId,
          batch.productId,
          { repairDelta: -dto.bottlesWrittenOff },
          WarehouseTransactionType.WRITE_OFF,
          { notes: dto.notes ?? 'Written off from repair batch', createdById: userId, repairBatchId: batchId },
          tx,
        );
      }

      return tx.repairBatch.findUnique({ where: { id: batchId } });
    });
  }

  async writeOff(vendorId: string, dto: WriteOffDto, userId: string) {
    const deltas =
      dto.fromStock === 'damaged'
        ? { damagedDelta: -dto.quantity }
        : { leakedDelta: -dto.quantity };

    await this.prisma.$transaction(async (tx) => {
      await this.applyDeltas(
        vendorId,
        dto.productId,
        deltas,
        WarehouseTransactionType.WRITE_OFF,
        { notes: dto.notes, createdById: userId },
        tx,
      );
    });
  }

  async adjustment(vendorId: string, dto: AdjustmentDto, userId: string) {
    await this.prisma.$transaction(async (tx) => {
      await this.applyDeltas(
        vendorId,
        dto.productId,
        {
          filledDelta: dto.filledAdjust,
          emptyDelta: dto.emptyAdjust,
          damagedDelta: dto.damagedAdjust,
          leakedDelta: dto.leakedAdjust,
        },
        WarehouseTransactionType.ADJUSTMENT,
        { notes: dto.notes, createdById: userId },
        tx,
      );
    });
  }

  // ─── Auto-hooks called from DailySheetService ─────────────────────────────

  async recordLoadOut(
    vendorId: string,
    productId: string,
    quantity: number,
    dailySheetId: string,
    tx: Prisma.TransactionClient,
  ) {
    await this.applyDeltas(
      vendorId,
      productId,
      { filledDelta: -quantity },
      WarehouseTransactionType.LOAD_OUT,
      { dailySheetId },
      tx,
    );
  }

  async recordCheckinFilled(
    vendorId: string,
    productId: string,
    quantity: number,
    dailySheetId: string,
    tx: Prisma.TransactionClient,
  ) {
    if (quantity <= 0) return;
    await this.applyDeltas(
      vendorId,
      productId,
      { filledDelta: quantity },
      WarehouseTransactionType.CHECK_IN_FILLED,
      { dailySheetId },
      tx,
    );
  }

  async recordCheckinEmpty(
    vendorId: string,
    productId: string,
    quantity: number,
    dailySheetId: string,
    tx: Prisma.TransactionClient,
  ) {
    if (quantity <= 0) return;
    await this.applyDeltas(
      vendorId,
      productId,
      { emptyDelta: quantity },
      WarehouseTransactionType.CHECK_IN_EMPTY,
      { dailySheetId },
      tx,
    );
  }

  async recordCheckinDamaged(
    vendorId: string,
    productId: string,
    quantity: number,
    dailySheetId: string,
    tx: Prisma.TransactionClient,
  ) {
    if (quantity <= 0) return;
    await this.applyDeltas(
      vendorId,
      productId,
      { damagedDelta: quantity },
      WarehouseTransactionType.CHECK_IN_DAMAGED,
      { dailySheetId },
      tx,
    );
  }

  async recordCheckinLeaked(
    vendorId: string,
    productId: string,
    quantity: number,
    dailySheetId: string,
    tx: Prisma.TransactionClient,
  ) {
    if (quantity <= 0) return;
    await this.applyDeltas(
      vendorId,
      productId,
      { leakedDelta: quantity },
      WarehouseTransactionType.CHECK_IN_LEAKED,
      { dailySheetId },
      tx,
    );
  }

  // ─── Auto-refill (nightly, opt-in) ─────────────────────────────────────────
  // Temporary policy toggle: when enabled, every emptyCount bottle collected
  // from customers is treated as filled again by the next morning, without
  // waiting for a manual Refill. Check-in itself is untouched (still records
  // real empties via recordCheckinEmpty above) — this job sweeps emptyCount
  // -> filledCount for the whole vendor once a night. Reversible: turn the
  // config off and the manual-only Refill flow is exactly what it was before.

  async getAutoRefillConfig(vendorId: string) {
    const config = await this.prisma.warehouseAutoRefillConfig.findUnique({
      where: { vendorId },
    });
    return { enabled: config?.enabled ?? false };
  }

  async updateAutoRefillConfig(vendorId: string, dto: UpdateAutoRefillConfigDto) {
    const config = await this.prisma.warehouseAutoRefillConfig.upsert({
      where: { vendorId },
      create: { vendorId, enabled: dto.enabled },
      update: { enabled: dto.enabled },
    });
    return { enabled: config.enabled };
  }

  /** Sweeps emptyCount -> filledCount for every product of one vendor. Used by the nightly job; safe to call directly too (e.g. tests). */
  async runAutoRefillForVendor(vendorId: string): Promise<{ productsRefilled: number; bottlesRefilled: number }> {
    const stocks = await this.prisma.warehouseStock.findMany({
      where: { vendorId, emptyCount: { gt: 0 } },
    });

    let productsRefilled = 0;
    let bottlesRefilled = 0;

    for (const stock of stocks) {
      await this.prisma.$transaction(async (tx) => {
        await this.applyDeltas(
          vendorId,
          stock.productId,
          { emptyDelta: -stock.emptyCount, filledDelta: stock.emptyCount },
          WarehouseTransactionType.AUTO_REFILL,
          { notes: 'Nightly auto-refill (empty received from customers)' },
          tx,
        );
      });
      productsRefilled++;
      bottlesRefilled += stock.emptyCount;
    }

    return { productsRefilled, bottlesRefilled };
  }

  /** Fan-out entry point for the scheduled job: every vendor with the toggle enabled. */
  async runAutoRefillForAllVendors(): Promise<{ vendorsProcessed: number; bottlesRefilled: number }> {
    const configs = await this.prisma.warehouseAutoRefillConfig.findMany({
      where: { enabled: true, vendor: { isActive: true } },
      select: { vendorId: true },
    });

    let vendorsProcessed = 0;
    let bottlesRefilled = 0;

    for (const { vendorId } of configs) {
      const result = await this.runAutoRefillForVendor(vendorId);
      vendorsProcessed++;
      bottlesRefilled += result.bottlesRefilled;
    }

    return { vendorsProcessed, bottlesRefilled };
  }
}
