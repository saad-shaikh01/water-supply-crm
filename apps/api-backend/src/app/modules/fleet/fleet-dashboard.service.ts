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
    const [fuelAgg, serviceAgg, profile] = await Promise.all([
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
    };
  }
}
