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
  fuelCard: { select: { id: true, name: true } },
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

    // Fuel Card Wallet (owner-requested 2026-09-15): when a specific FuelCard
    // paid for this fill, it must belong to this vendor and be active. The
    // top-up itself already left Office Cash (FuelCardTopUpService) — this
    // fill only draws down that card's own balance, so paidFromCash is forced
    // false regardless of what the caller sent (mirrors the "cash never
    // touched" reality of every other non-cash fill).
    if (dto.fuelCardId) {
      const card = await this.prisma.fuelCard.findFirst({
        where: { id: dto.fuelCardId, vendorId: user.vendorId },
      });
      if (!card) throw new NotFoundException('Fuel card not found');
      if (!card.isActive) throw new BadRequestException('This fuel card is inactive.');
    }

    let sheetVanId: string | null = null;
    // Trip attribution for the spawned Expense — same server-side inference as
    // ExpenseService.create / CrewCashDistributionService.create: the Expense
    // is pinned to whichever trip is currently open on the sheet (null if
    // none). Without it every fuel Expense stayed unattributed and the
    // per-trip EXPENSE / cash-in-hand breakdown (sheet-detail.tsx tripStats +
    // the printed Trip Summary) silently dropped fuel, overstating each
    // trip's running cash-in-hand by the cash-paid fuel amount.
    let dailySheetLoadId: string | null = null;
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

      const activeLoad = await this.prisma.dailySheetLoad.findFirst({
        where: { dailySheetId: dto.dailySheetId, endedAt: null },
        select: { id: true },
      });
      dailySheetLoadId = activeLoad?.id ?? null;

      // Odometer sanity gate (owner request): a fuel fill logged against a
      // sheet must not read lower than that sheet's own Start-of-Day Vehicle
      // Check — the odometer physically cannot have gone backwards since the
      // trip started. Requires the START check to exist at all (blocking,
      // not just flagging, per owner decision) since without it there is no
      // baseline to validate against.
      const startCheck = await this.prisma.vehicleDailyCheck.findUnique({
        where: { dailySheetId_checkType: { dailySheetId: dto.dailySheetId, checkType: 'START' } },
        select: { odometerReading: true },
      });
      if (!startCheck) {
        throw new BadRequestException('Record the Start-of-Day Vehicle Check for this sheet before logging fuel.');
      }
      if (dto.odometerAtFill < startCheck.odometerReading) {
        throw new BadRequestException(
          `Odometer (${dto.odometerAtFill} km) cannot be less than today's start-of-day reading (${startCheck.odometerReading} km).`,
        );
      }
    } else {
      // No sheet context (Fleet's own "Log Fuel Fill" on the Vehicle Detail
      // page) — no Start-of-Day check to anchor against, so fall back to the
      // vehicle's own last recorded reading across both odometer sources, the
      // same "can't go backwards" guarantee VehicleDailyCheck itself enforces
      // (see odometerContinuityFlag comment in schema.prisma).
      const [lastFuelLog, lastCheck] = await Promise.all([
        this.prisma.fuelLog.aggregate({ where: { vehicleId: dto.vehicleId }, _max: { odometerAtFill: true } }),
        this.prisma.vehicleDailyCheck.aggregate({ where: { vehicleId: dto.vehicleId }, _max: { odometerReading: true } }),
      ]);
      const lastKnownReading = Math.max(lastFuelLog._max.odometerAtFill ?? 0, lastCheck._max.odometerReading ?? 0);
      if (dto.odometerAtFill < lastKnownReading) {
        throw new BadRequestException(
          `Odometer (${dto.odometerAtFill} km) cannot be less than this vehicle's last recorded reading (${lastKnownReading} km).`,
        );
      }
    }

    // Most fills come straight out of the driver's collected cash — default
    // true so the common case needs no extra tap. Set false on the form when
    // fuel was paid by card/bank/company account instead: the Expense this
    // spawns then no longer reduces the driver's cash hand-in (see
    // daily-sheet.service.ts buildReconciliation).
    const paidFromCash = dto.fuelCardId ? false : (dto.paidFromCash ?? true);

    return this.prisma.$transaction(async (tx) => {
      const expense = await tx.expense.create({
        data: {
          vendorId: user.vendorId,
          category: ExpenseCategory.FUEL_EXPENSE,
          amount: dto.amountPaid,
          paidFromCash,
          fuelCardId: dto.fuelCardId ?? null,
          description: `Fuel — ${dto.litersFilled}L (${vehicle.plateNumber})`,
          date: new Date(dto.date),
          vanId: sheetVanId,
          dailySheetId: dto.dailySheetId ?? null,
          dailySheetLoadId,
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
          fuelCardId: dto.fuelCardId ?? null,
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

    // Fuel Card Wallet (owner-requested 2026-09-15): re-validate a newly-set
    // card and force paidFromCash = false with it, same as create(). Passing
    // fuelCardId: null clears a previously-set card without forcing
    // paidFromCash either way — the caller's own paidFromCash (or the
    // existing value) then applies.
    let paidFromCash = dto.paidFromCash;
    if (dto.fuelCardId !== undefined && dto.fuelCardId !== null) {
      const card = await this.prisma.fuelCard.findFirst({ where: { id: dto.fuelCardId, vendorId } });
      if (!card) throw new NotFoundException('Fuel card not found');
      if (!card.isActive) throw new BadRequestException('This fuel card is inactive.');
      paidFromCash = false;
    }

    return this.prisma.$transaction(async (tx) => {
      if (
        fuelLog.expenseId &&
        (dto.amountPaid !== undefined ||
          dto.date !== undefined ||
          dto.litersFilled !== undefined ||
          paidFromCash !== undefined ||
          dto.fuelCardId !== undefined)
      ) {
        await tx.expense.update({
          where: { id: fuelLog.expenseId },
          data: {
            ...(dto.amountPaid !== undefined && { amount: dto.amountPaid }),
            ...(paidFromCash !== undefined && { paidFromCash }),
            ...(dto.fuelCardId !== undefined && { fuelCardId: dto.fuelCardId }),
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
          ...(paidFromCash !== undefined && { paidFromCash }),
          ...(dto.fuelCardId !== undefined && { fuelCardId: dto.fuelCardId }),
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
