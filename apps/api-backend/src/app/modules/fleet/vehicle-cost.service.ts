import { Injectable, NotFoundException } from '@nestjs/common';
import { ExpenseCategory } from '@prisma/client';
import { PrismaService } from '@water-supply-crm/database';
import { paginate } from '../../common/helpers/paginate';
import {
  PeriodRange,
  computeFuelAvgKmPerLiter,
  currentMonthKey,
  lastMonthKeys,
  monthRange,
  pktMonthKey,
} from './fleet-period.util';

/**
 * Expense has no vehicleId (route/van level, §17.2), so "other" vehicle costs
 * are attributed through the daily sheet: the sheet's vehicle check names the
 * physical vehicle. FUEL_EXPENSE / VEHICLE_MAINTENANCE are excluded on purpose —
 * those are already counted from FuelLog / VehicleServiceRecord (no double count).
 */
export const VEHICLE_OTHER_EXPENSE_CATEGORIES: ExpenseCategory[] = [
  ExpenseCategory.POLICE,
  ExpenseCategory.VEHICLE_RENT,
  ExpenseCategory.OTHER,
];

export interface VehiclePeriodStats {
  fuelCost: number;
  fuelLiters: number;
  fuelFills: number;
  maintenanceCost: number;
  serviceCount: number;
  otherCost: number;
  totalCost: number;
  kmDriven: number;
  daysUsed: number;
  costPerKm: number | null;
  avgKmPerLiter: number | null;
  avgPricePerLiter: number | null;
  lastFuelAt: Date | null;
}

interface RawFuel {
  vehicleId: string;
  date: Date;
  litersFilled: number;
  amountPaid: number;
  odometerAtFill: number;
  isFullTank: boolean;
}
interface RawService {
  vehicleId: string;
  performedAtDate: Date;
  cost: number;
}
interface RawCheck {
  vehicleId: string | null;
  dailySheetId: string;
  checkType: 'START' | 'END';
  odometerReading: number;
  dailySheet: { date: Date };
}
interface RawExpense {
  id: string;
  amount: number;
  date: Date;
  dailySheetId: string | null;
}
interface RawData {
  fuel: RawFuel[];
  service: RawService[];
  checks: RawCheck[];
  expenses: RawExpense[];
}

const EMPTY_RAW: RawData = { fuel: [], service: [], checks: [], expenses: [] };

@Injectable()
export class VehicleCostService {
  constructor(private prisma: PrismaService) {}

  private async load(vendorId: string, vehicleIds: string[], range: PeriodRange): Promise<RawData> {
    if (!vehicleIds.length) return EMPTY_RAW;
    const [fuel, service, checks] = await Promise.all([
      this.prisma.fuelLog.findMany({
        where: { vendorId, vehicleId: { in: vehicleIds }, date: { gte: range.from, lt: range.to } },
        select: {
          vehicleId: true,
          date: true,
          litersFilled: true,
          amountPaid: true,
          odometerAtFill: true,
          isFullTank: true,
        },
        orderBy: { odometerAtFill: 'asc' },
      }),
      this.prisma.vehicleServiceRecord.findMany({
        where: { vendorId, vehicleId: { in: vehicleIds }, performedAtDate: { gte: range.from, lt: range.to } },
        select: { vehicleId: true, performedAtDate: true, cost: true },
      }),
      this.prisma.vehicleDailyCheck.findMany({
        where: { vendorId, vehicleId: { in: vehicleIds }, dailySheet: { date: { gte: range.from, lt: range.to } } },
        select: {
          vehicleId: true,
          dailySheetId: true,
          checkType: true,
          odometerReading: true,
          dailySheet: { select: { date: true } },
        },
      }),
    ]);

    const sheetIds = [...new Set(checks.map((c) => c.dailySheetId))];
    const expenses = sheetIds.length
      ? await this.prisma.expense.findMany({
          where: {
            vendorId,
            dailySheetId: { in: sheetIds },
            category: { in: VEHICLE_OTHER_EXPENSE_CATEGORIES },
            date: { gte: range.from, lt: range.to },
          },
          select: { id: true, amount: true, date: true, dailySheetId: true },
        })
      : [];

    return { fuel, service, checks: checks as RawCheck[], expenses };
  }

  /** Aggregates one vehicle's slice of `raw`; `inSlice` narrows by date (e.g. one month). */
  private summarize(raw: RawData, vehicleId: string, inSlice: (d: Date) => boolean = () => true): VehiclePeriodStats {
    const fuel = raw.fuel.filter((f) => f.vehicleId === vehicleId && inSlice(f.date));
    const service = raw.service.filter((s) => s.vehicleId === vehicleId && inSlice(s.performedAtDate));
    const checks = raw.checks.filter((c) => c.vehicleId === vehicleId && inSlice(c.dailySheet.date));

    const bySheet = new Map<string, { start?: number; end?: number }>();
    for (const c of checks) {
      const e = bySheet.get(c.dailySheetId) ?? {};
      if (c.checkType === 'START') e.start = c.odometerReading;
      else e.end = c.odometerReading;
      bySheet.set(c.dailySheetId, e);
    }
    let kmDriven = 0;
    for (const { start, end } of bySheet.values()) {
      if (start != null && end != null && end >= start) kmDriven += end - start;
    }

    const sheetIds = new Set(bySheet.keys());
    const other = raw.expenses.filter((x) => x.dailySheetId && sheetIds.has(x.dailySheetId) && inSlice(x.date));

    const fuelCost = fuel.reduce((s, f) => s + f.amountPaid, 0);
    const fuelLiters = fuel.reduce((s, f) => s + f.litersFilled, 0);
    const maintenanceCost = service.reduce((s, r) => s + r.cost, 0);
    const otherCost = other.reduce((s, x) => s + x.amount, 0);
    const totalCost = fuelCost + maintenanceCost + otherCost;
    const lastFuel = fuel.reduce<Date | null>((m, f) => (!m || f.date > m ? f.date : m), null);

    return {
      fuelCost,
      fuelLiters,
      fuelFills: fuel.length,
      maintenanceCost,
      serviceCount: service.length,
      otherCost,
      totalCost,
      kmDriven,
      daysUsed: bySheet.size,
      costPerKm: kmDriven > 0 ? totalCost / kmDriven : null,
      avgKmPerLiter: computeFuelAvgKmPerLiter(fuel),
      avgPricePerLiter: fuelLiters > 0 ? fuelCost / fuelLiters : null,
      lastFuelAt: lastFuel,
    };
  }

  /** Per-vehicle stats for the fleet list page (one month) or a custom range. */
  async getStatsForVehicles(vendorId: string, vehicleIds: string[], range: PeriodRange) {
    const raw = await this.load(vendorId, vehicleIds, range);
    return new Map(vehicleIds.map((id) => [id, this.summarize(raw, id)]));
  }

  async getStatsForMonth(vendorId: string, vehicleIds: string[], month = currentMonthKey()) {
    return this.getStatsForVehicles(vendorId, vehicleIds, monthRange(month));
  }

  /** One row per month (oldest first) — feeds the detail page chart + month-wise table. */
  async getMonthlyReport(vendorId: string, vehicleId: string, months = 12, endMonth = currentMonthKey()) {
    await this.assertVehicle(vendorId, vehicleId);
    const keys = lastMonthKeys(months, endMonth);
    const range = { from: monthRange(keys[0]).from, to: monthRange(keys[keys.length - 1]).to };
    const raw = await this.load(vendorId, [vehicleId], range);
    return keys.map((key) => ({ month: key, ...this.summarize(raw, vehicleId, (d) => pktMonthKey(d) === key) }));
  }

  async getPeriodSummary(vendorId: string, vehicleId: string, range: PeriodRange) {
    await this.assertVehicle(vendorId, vehicleId);
    const raw = await this.load(vendorId, [vehicleId], range);
    return this.summarize(raw, vehicleId);
  }

  /** The attributed "other" expenses behind a vehicle's Other Cost figure. */
  async listOtherExpenses(vendorId: string, vehicleId: string, range: PeriodRange, page = 1, limit = 20) {
    await this.assertVehicle(vendorId, vehicleId);
    const sheets = await this.prisma.vehicleDailyCheck.findMany({
      where: { vendorId, vehicleId, dailySheet: { date: { gte: range.from, lt: range.to } } },
      select: { dailySheetId: true },
      distinct: ['dailySheetId'],
    });
    const where = {
      vendorId,
      dailySheetId: { in: sheets.map((s) => s.dailySheetId) },
      category: { in: VEHICLE_OTHER_EXPENSE_CATEGORIES },
      date: { gte: range.from, lt: range.to },
    };
    const [data, total, agg] = await Promise.all([
      this.prisma.expense.findMany({
        where,
        select: {
          id: true,
          category: true,
          amount: true,
          description: true,
          date: true,
          paidFromCash: true,
          createdBy: { select: { id: true, name: true } },
          dailySheet: { select: { id: true, date: true, van: { select: { id: true, plateNumber: true } } } },
        },
        orderBy: { date: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.expense.count({ where }),
      this.prisma.expense.aggregate({ where, _sum: { amount: true } }),
    ]);
    return { ...paginate(data, total, page, limit), summary: { totalAmount: agg._sum.amount ?? 0 } };
  }

  private async assertVehicle(vendorId: string, vehicleId: string) {
    const v = await this.prisma.vehicle.findFirst({ where: { id: vehicleId, vendorId }, select: { id: true } });
    if (!v) throw new NotFoundException('Vehicle not found');
  }
}
