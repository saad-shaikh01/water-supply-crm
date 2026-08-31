import { Injectable } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { VehicleMaintenanceService } from './vehicle-maintenance.service';

/**
 * §17 Amendment (2026-08-21): vehicle-specific rollups (odometer, fuel
 * efficiency, maintenance due, document expiry) are regrouped by
 * `vehicleId`. Route/crew/delivery-count rollups are untouched — this
 * service never touched those to begin with.
 */
@Injectable()
export class FleetDashboardService {
  constructor(
    private prisma: PrismaService,
    private maintenance: VehicleMaintenanceService,
  ) {}

  /** Vendor-wide Fleet overview: the four headline numbers from the plan doc §14. */
  async getOverview(vendorId: string) {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const [vehicleCount, maintenanceStatus, expiringDocuments, costAgg, fuelAgg] = await Promise.all([
      this.prisma.vehicle.count({ where: { vendorId, isActive: true } }),
      this.maintenance.getFleetWideStatus(vendorId),
      this.prisma.vehicleDocument.findMany({
        where: {
          vendorId,
          isActive: true,
          expiryDate: { not: null, lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
        },
        include: { vehicle: { select: { id: true, plateNumber: true } } },
        orderBy: { expiryDate: 'asc' },
        take: 50,
      }),
      // Vendor-wide monthly vehicle-related cost — Expense stays route/vanId
      // level (§17.2), so this is a company-wide total, not attributable to
      // a specific vehicle (see getVehicleCostSummary below for the
      // per-vehicle breakdown, which uses FuelLog/VehicleServiceRecord
      // instead since those did move to vehicleId).
      this.prisma.expense.aggregate({
        where: { vendorId, vanId: { not: null }, date: { gte: monthStart } },
        _sum: { amount: true },
      }),
      this.prisma.fuelLog.aggregate({
        where: { vendorId, date: { gte: monthStart } },
        _sum: { amountPaid: true, litersFilled: true },
      }),
    ]);

    return {
      vehicleCount,
      totalOverdueMaintenance: maintenanceStatus.totalOverdue,
      totalDueMaintenance: maintenanceStatus.totalDue,
      vehiclesWithOverdue: maintenanceStatus.vehicles.filter((v) => v.overdueCount > 0),
      expiringDocuments,
      costThisMonth: costAgg._sum.amount ?? 0,
      fuelCostThisMonth: fuelAgg._sum.amountPaid ?? 0,
      fuelLitersThisMonth: fuelAgg._sum.litersFilled ?? 0,
    };
  }

  /**
   * Per-vehicle cost breakdown for the vehicle profile page. Only sources
   * that actually carry `vehicleId` after the §17 Amendment — fuel
   * (FuelLog) and maintenance (VehicleServiceRecord) — are attributable to
   * a specific vehicle; generic Expense rows stayed vanId/route-level and
   * can no longer be broken down "by vehicle" (judgment call, see PR notes).
   */
  async getVehicleCostSummary(vendorId: string, vehicleId: string) {
    const [fuelAgg, serviceAgg, profile, fuelLogs] = await Promise.all([
      this.prisma.fuelLog.aggregate({
        where: { vendorId, vehicleId },
        _sum: { amountPaid: true, litersFilled: true },
        _count: { id: true },
      }),
      this.prisma.vehicleServiceRecord.aggregate({
        where: { vendorId, vehicleId },
        _sum: { cost: true },
        _count: { id: true },
      }),
      this.prisma.vehicleProfile.findUnique({ where: { vehicleId } }),
      this.prisma.fuelLog.findMany({
        where: { vendorId, vehicleId },
        orderBy: { odometerAtFill: 'asc' },
        select: { odometerAtFill: true, litersFilled: true, isFullTank: true },
      }),
    ]);

    const fuelCostTotal = fuelAgg._sum.amountPaid ?? 0;
    const maintenanceCostTotal = serviceAgg._sum.cost ?? 0;
    const totalCost = fuelCostTotal + maintenanceCostTotal;
    const currentOdometer = profile?.currentOdometer ?? 0;

    return {
      vehicleId,
      totalCost,
      fuelCostTotal,
      fuelLitersTotal: fuelAgg._sum.litersFilled ?? 0,
      fuelFillCount: fuelAgg._count.id,
      maintenanceCostTotal,
      maintenanceServiceCount: serviceAgg._count.id,
      currentOdometer,
      costPerKm: currentOdometer > 0 ? totalCost / currentOdometer : null,
      fuelAvgKmPerLiter: this.computeFuelAvgKmPerLiter(fuelLogs),
    };
  }

  /**
   * Real-world fuel efficiency in km per litre, computed by the
   * "full-to-full" method: distance between the first and last full-tank
   * fill, divided by every litre put in *after* that first full tank (those
   * litres are exactly what was burned to cover that distance).
   *
   * Falls back to a first-fill-to-last-fill estimate (total litres minus the
   * first fill) when there are fewer than two full-tank fills but at least
   * two fills overall. Returns null when there isn't enough data or the
   * numbers don't make sense (odometer went backwards, zero litres).
   */
  private computeFuelAvgKmPerLiter(
    logs: { odometerAtFill: number; litersFilled: number; isFullTank: boolean }[],
  ): number | null {
    if (logs.length < 2) return null;

    const fullIdx = logs.reduce<number[]>((acc, l, i) => (l.isFullTank ? [...acc, i] : acc), []);

    let startIdx: number;
    let endIdx: number;
    let liters: number;

    if (fullIdx.length >= 2) {
      startIdx = fullIdx[0];
      endIdx = fullIdx[fullIdx.length - 1];
      liters = logs.slice(startIdx + 1, endIdx + 1).reduce((s, l) => s + l.litersFilled, 0);
    } else {
      startIdx = 0;
      endIdx = logs.length - 1;
      liters = logs.slice(1).reduce((s, l) => s + l.litersFilled, 0);
    }

    const distance = logs[endIdx].odometerAtFill - logs[startIdx].odometerAtFill;
    if (distance <= 0 || liters <= 0) return null;

    return distance / liters;
  }
}
