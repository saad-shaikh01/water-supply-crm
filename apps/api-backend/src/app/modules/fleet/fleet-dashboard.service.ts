import { Injectable } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { VehicleMaintenanceService } from './vehicle-maintenance.service';

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
      this.prisma.van.count({ where: { vendorId, isActive: true } }),
      this.maintenance.getFleetWideStatus(vendorId),
      this.prisma.vehicleDocument.findMany({
        where: {
          vendorId,
          isActive: true,
          expiryDate: { not: null, lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
        },
        include: { van: { select: { id: true, plateNumber: true } } },
        orderBy: { expiryDate: 'asc' },
        take: 50,
      }),
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

  /** Per-vehicle cost breakdown for the vehicle profile page. */
  async getVehicleCostSummary(vendorId: string, vanId: string) {
    const [expensesByCategory, fuelAgg, serviceAgg, profile] = await Promise.all([
      this.prisma.expense.groupBy({
        by: ['category'],
        where: { vendorId, vanId },
        _sum: { amount: true },
        _count: { id: true },
      }),
      this.prisma.fuelLog.aggregate({
        where: { vendorId, vanId },
        _sum: { amountPaid: true, litersFilled: true },
        _count: { id: true },
      }),
      this.prisma.vehicleServiceRecord.aggregate({
        where: { vendorId, vanId },
        _sum: { cost: true },
        _count: { id: true },
      }),
      this.prisma.vehicleProfile.findUnique({ where: { vanId } }),
    ]);

    const totalCost = expensesByCategory.reduce((sum, c) => sum + (c._sum.amount ?? 0), 0);
    const currentOdometer = profile?.currentOdometer ?? 0;

    return {
      vanId,
      totalCost,
      costByCategory: expensesByCategory.map((c) => ({
        category: c.category,
        totalAmount: c._sum.amount ?? 0,
        count: c._count.id,
      })),
      fuelCostTotal: fuelAgg._sum.amountPaid ?? 0,
      fuelLitersTotal: fuelAgg._sum.litersFilled ?? 0,
      fuelFillCount: fuelAgg._count.id,
      maintenanceCostTotal: serviceAgg._sum.cost ?? 0,
      maintenanceServiceCount: serviceAgg._count.id,
      currentOdometer,
      costPerKm: currentOdometer > 0 ? totalCost / currentOdometer : null,
    };
  }
}
