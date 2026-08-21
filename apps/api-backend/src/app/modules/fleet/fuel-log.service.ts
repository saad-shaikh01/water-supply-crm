import { BadRequestException, Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { ExpenseCategory } from '@prisma/client';
import { paginate } from '../../common/helpers/paginate';
import type { AuthUser } from '@water-supply-crm/types';
import { CreateFuelLogDto } from './dto/create-fuel-log.dto';
import { UpdateFuelLogDto } from './dto/update-fuel-log.dto';
import { FuelLogQueryDto } from './dto/fuel-log-query.dto';

const fuelLogInclude = {
  recordedBy: { select: { id: true, name: true } },
  vehicle: { select: { id: true, plateNumber: true } },
};

/**
 * FuelLog is the fill-to-fill efficiency data source, deliberately separate
 * from the daily-check fuel gauge glance (plan doc §6/§7.5). Mirrors Expense's
 * own simplicity (no version/audit ceremony — Expense itself has none) and
 * spawns exactly one linked, always-in-lockstep Expense row — the vendor-cost
 * analog of CrewCashDistribution's "source record -> financial consequence"
 * split, minus the payroll-approval apparatus that split needed.
 *
 * §17 Amendment (2026-08-21): keyed off `vehicleId` (the physical vehicle
 * that was fuelled), not `vanId` — a fill-to-fill efficiency number is
 * meaningless if the liters and the odometer delta belong to two different
 * trucks (§17.1). Expense.vanId (route-level, unchanged) is still populated
 * when a dailySheetId is provided, read from that sheet's own van — Expense
 * itself did not move to vehicleId (§17.2).
 */
@Injectable()
export class FuelLogService {
  constructor(private prisma: PrismaService) {}

  async create(user: AuthUser, dto: CreateFuelLogDto) {
    const vehicle = await this.prisma.vehicle.findFirst({ where: { id: dto.vehicleId, vendorId: user.vendorId } });
    if (!vehicle) throw new NotFoundException('Vehicle not found');
    if (!vehicle.isActive) throw new BadRequestException('This vehicle is inactive.');

    let sheetVanId: string | null = null;
    if (dto.dailySheetId) {
      const sheet = await this.prisma.dailySheet.findFirst({
        where: { id: dto.dailySheetId, vendorId: user.vendorId },
        select: { vanId: true, driverId: true, isClosed: true },
      });
      if (!sheet) throw new NotFoundException('Daily sheet not found');
      if (user.role === 'DRIVER' && sheet.driverId !== user.userId) {
        throw new ForbiddenException('You can only record fuel for your own delivery van.');
      }
      // Same closed-sheet business rule already enforced by
      // CrewCashDistributionService.create — a Fuel Log spawns an Expense
      // too and must not be added after the sheet is finalized.
      if (sheet.isClosed) {
        throw new BadRequestException('Cannot record a Fuel Log against a closed daily sheet.');
      }
      sheetVanId = sheet.vanId;
    }

    // Most fills come straight out of the driver's collected cash — default
    // true so the common case needs no extra tap. Set false on the form when
    // fuel was paid by card/bank/company account instead: the Expense this
    // spawns then no longer reduces the driver's cash hand-in (see
    // daily-sheet.service.ts buildReconciliation).
    const paidFromCash = dto.paidFromCash ?? true;

    return this.prisma.$transaction(async (tx) => {
      const expense = await tx.expense.create({
        data: {
          vendorId: user.vendorId,
          category: ExpenseCategory.FUEL_EXPENSE,
          amount: dto.amountPaid,
          paidFromCash,
          description: `Fuel — ${dto.litersFilled}L (${vehicle.plateNumber})`,
          date: new Date(dto.date),
          vanId: sheetVanId,
          dailySheetId: dto.dailySheetId ?? null,
          createdById: user.userId,
        },
      });

      return tx.fuelLog.create({
        data: {
          vendorId: user.vendorId,
          vehicleId: dto.vehicleId,
          dailySheetId: dto.dailySheetId ?? null,
          date: new Date(dto.date),
          odometerAtFill: dto.odometerAtFill,
          litersFilled: dto.litersFilled,
          amountPaid: dto.amountPaid,
          paidFromCash,
          isFullTank: dto.isFullTank ?? true,
          fuelStation: dto.fuelStation ?? null,
          receiptPhotoKey: dto.receiptPhotoKey ?? null,
          notes: dto.notes ?? null,
          expenseId: expense.id,
          recordedById: user.userId,
        },
        include: fuelLogInclude,
      });
    });
  }

  async findAll(vendorId: string, query: FuelLogQueryDto) {
    const { page = 1, limit = 20, vehicleId, dateFrom, dateTo } = query;
    const where: any = { vendorId };
    if (vehicleId) where.vehicleId = vehicleId;
    if (dateFrom || dateTo) {
      where.date = {};
      if (dateFrom) where.date.gte = new Date(dateFrom);
      if (dateTo) {
        const end = new Date(dateTo);
        end.setHours(23, 59, 59, 999);
        where.date.lte = end;
      }
    }

    const [data, total] = await Promise.all([
      this.prisma.fuelLog.findMany({
        where,
        include: fuelLogInclude,
        orderBy: { date: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.fuelLog.count({ where }),
    ]);

    return paginate(data, total, page, limit);
  }

  async findOne(vendorId: string, id: string) {
    const fuelLog = await this.prisma.fuelLog.findFirst({ where: { id, vendorId }, include: fuelLogInclude });
    if (!fuelLog) throw new NotFoundException('Fuel log not found');
    return fuelLog;
  }

  async update(vendorId: string, id: string, dto: UpdateFuelLogDto) {
    const fuelLog = await this.prisma.fuelLog.findFirst({ where: { id, vendorId } });
    if (!fuelLog) throw new NotFoundException('Fuel log not found');

    return this.prisma.$transaction(async (tx) => {
      if (fuelLog.expenseId && (dto.amountPaid !== undefined || dto.date !== undefined || dto.litersFilled !== undefined || dto.paidFromCash !== undefined)) {
        await tx.expense.update({
          where: { id: fuelLog.expenseId },
          data: {
            ...(dto.amountPaid !== undefined && { amount: dto.amountPaid }),
            ...(dto.paidFromCash !== undefined && { paidFromCash: dto.paidFromCash }),
            ...(dto.date !== undefined && { date: new Date(dto.date) }),
            ...(dto.litersFilled !== undefined && {
              description: `Fuel — ${dto.litersFilled}L`,
            }),
          },
        });
      }

      return tx.fuelLog.update({
        where: { id },
        data: {
          ...(dto.date !== undefined && { date: new Date(dto.date) }),
          ...(dto.odometerAtFill !== undefined && { odometerAtFill: dto.odometerAtFill }),
          ...(dto.litersFilled !== undefined && { litersFilled: dto.litersFilled }),
          ...(dto.amountPaid !== undefined && { amountPaid: dto.amountPaid }),
          ...(dto.paidFromCash !== undefined && { paidFromCash: dto.paidFromCash }),
          ...(dto.isFullTank !== undefined && { isFullTank: dto.isFullTank }),
          ...(dto.fuelStation !== undefined && { fuelStation: dto.fuelStation }),
          ...(dto.receiptPhotoKey !== undefined && { receiptPhotoKey: dto.receiptPhotoKey }),
          ...(dto.notes !== undefined && { notes: dto.notes }),
        },
        include: fuelLogInclude,
      });
    });
  }

  async remove(vendorId: string, id: string) {
    const fuelLog = await this.prisma.fuelLog.findFirst({ where: { id, vendorId } });
    if (!fuelLog) throw new NotFoundException('Fuel log not found');

    await this.prisma.$transaction(async (tx) => {
      await tx.fuelLog.delete({ where: { id } });
      if (fuelLog.expenseId) {
        await tx.expense.delete({ where: { id: fuelLog.expenseId } });
      }
    });
    return { deleted: true };
  }
}
