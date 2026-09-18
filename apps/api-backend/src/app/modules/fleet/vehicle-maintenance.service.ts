import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { ExpenseCategory } from '@prisma/client';
import { paginate } from '../../common/helpers/paginate';
import type { AuthUser } from '@water-supply-crm/types';
import { AuditService } from '../audit/audit.service';
import { VehicleServiceTypeService } from './vehicle-service-type.service';
import { UpdateMaintenanceRuleDto } from './dto/update-maintenance-rule.dto';
import { CreateServiceRecordDto } from './dto/create-service-record.dto';
import { UpdateServiceRecordDto } from './dto/update-service-record.dto';
import { ServiceRecordQueryDto } from './dto/service-record-query.dto';
import { computeMaintenanceStatus } from './fleet-maintenance.util';

const serviceRecordInclude = {
  recordedBy: { select: { id: true, name: true } },
  vehicle: { select: { id: true, plateNumber: true } },
};

/**
 * §17 Amendment (2026-08-21): re-keyed from `vanId` to `vehicleId` — service
 * intervals/history are truck-specific (engine wear, not route history), see
 * §17.1.
 */
@Injectable()
export class VehicleMaintenanceService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private serviceTypes: VehicleServiceTypeService,
  ) {}

  /**
   * Makes sure a vehicle has a rule row for every service type in the vendor's
   * catalogue, seeded from each type's default intervals. Always per-vehicle
   * (no separate vendor-wide default row — see schema comment on
   * VehicleMaintenanceRule). Runs on every status read so a type added later
   * (or a vehicle added after it) picks up its rule without a backfill; rules
   * a user switched off (isActive=false) still exist, so they are never re-created.
   */
  async ensureDefaultRules(vendorId: string, vehicleId: string): Promise<void> {
    const [types, existing] = await Promise.all([
      this.serviceTypes.listDefs(vendorId),
      this.prisma.vehicleMaintenanceRule.findMany({ where: { vehicleId }, select: { serviceType: true } }),
    ]);
    const have = new Set(existing.map((r) => r.serviceType));
    const missing = types.filter((t) => !have.has(t.key));
    if (missing.length === 0) return;

    await this.prisma.vehicleMaintenanceRule.createMany({
      data: missing.map((t) => ({
        vendorId,
        vehicleId,
        serviceType: t.key,
        intervalKm: t.defaultIntervalKm,
        intervalDays: t.defaultIntervalDays,
      })),
      skipDuplicates: true,
    });
  }

  async getStatusForVehicle(vendorId: string, vehicleId: string) {
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id: vehicleId, vendorId },
      include: { vehicleProfile: true },
    });
    if (!vehicle) throw new NotFoundException('Vehicle not found');

    await this.ensureDefaultRules(vendorId, vehicleId);
    const labelOf = await this.serviceTypes.getLabelMap(vendorId);

    const rules = await this.prisma.vehicleMaintenanceRule.findMany({
      where: { vehicleId, isActive: true },
      orderBy: { serviceType: 'asc' },
    });

    const latestRecords = await this.prisma.vehicleServiceRecord.findMany({
      where: { vehicleId },
      distinct: ['serviceType'],
      orderBy: { performedAtDate: 'desc' },
    });
    const latestByType = new Map(latestRecords.map((r) => [r.serviceType, r]));

    const currentOdometer = vehicle.vehicleProfile?.currentOdometer ?? 0;
    const baselineDate = vehicle.vehicleProfile?.createdAt ?? vehicle.createdAt;

    return rules.map((rule) => {
      const last = latestByType.get(rule.serviceType);
      const computed = computeMaintenanceStatus({
        intervalKm: rule.intervalKm,
        intervalDays: rule.intervalDays,
        lastServiceOdometer: last?.performedAtOdometer ?? null,
        lastServiceDate: last?.performedAtDate ?? null,
        currentOdometer,
        baselineDate,
      });

      return {
        ruleId: rule.id,
        vehicleId,
        serviceType: rule.serviceType,
        label: labelOf(rule.serviceType),
        intervalKm: rule.intervalKm,
        intervalDays: rule.intervalDays,
        lastServiceOdometer: last?.performedAtOdometer ?? null,
        lastServiceDate: last?.performedAtDate ?? null,
        ...computed,
      };
    });
  }

  /** Fleet-wide rollup for the dashboard — total overdue/due counts across every vehicle. */
  async getFleetWideStatus(vendorId: string) {
    const vehicles = await this.prisma.vehicle.findMany({
      where: { vendorId, isActive: true },
      select: { id: true, plateNumber: true },
    });

    const results = await Promise.all(
      vehicles.map(async (vehicle) => {
        const statuses = await this.getStatusForVehicle(vendorId, vehicle.id);
        return {
          vehicleId: vehicle.id,
          plateNumber: vehicle.plateNumber,
          overdueCount: statuses.filter((s) => s.urgency === 'OVERDUE').length,
          dueCount: statuses.filter((s) => s.urgency === 'DUE').length,
        };
      }),
    );

    return {
      vehicles: results,
      totalOverdue: results.reduce((sum, r) => sum + r.overdueCount, 0),
      totalDue: results.reduce((sum, r) => sum + r.dueCount, 0),
    };
  }

  async updateRule(user: AuthUser, id: string, dto: UpdateMaintenanceRuleDto) {
    const rule = await this.prisma.vehicleMaintenanceRule.findFirst({ where: { id, vendorId: user.vendorId } });
    if (!rule) throw new NotFoundException('Maintenance rule not found');

    const updated = await this.prisma.vehicleMaintenanceRule.update({
      where: { id },
      data: {
        ...(dto.intervalKm !== undefined && { intervalKm: dto.intervalKm }),
        ...(dto.intervalDays !== undefined && { intervalDays: dto.intervalDays }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });

    await this.audit.log({
      vendorId: user.vendorId,
      userId: user.userId,
      userName: user.name,
      action: 'UPDATED',
      entity: 'VehicleMaintenanceRule',
      entityId: id,
      changes: { before: rule, after: updated },
    });

    return updated;
  }

  async createServiceRecord(user: AuthUser, dto: CreateServiceRecordDto) {
    const vehicle = await this.prisma.vehicle.findFirst({ where: { id: dto.vehicleId, vendorId: user.vendorId } });
    if (!vehicle) throw new NotFoundException('Vehicle not found');
    const serviceLabel = await this.serviceTypes.assertKeyExists(user.vendorId, dto.serviceType);

    const record = await this.prisma.$transaction(async (tx) => {
      const expense = await tx.expense.create({
        data: {
          vendorId: user.vendorId,
          category: ExpenseCategory.VEHICLE_MAINTENANCE,
          amount: dto.cost,
          description: `${serviceLabel} — ${vehicle.plateNumber}`,
          date: new Date(dto.performedAtDate),
          // Expense stays route-level (§17.2) — this vehicle isn't
          // necessarily tied to a specific van/route at service time, so no
          // vanId is attached here (unchanged behavior: this field was never
          // populated for service-record Expenses even before the split).
          createdById: user.userId,
        },
      });

      return tx.vehicleServiceRecord.create({
        data: {
          vendorId: user.vendorId,
          vehicleId: dto.vehicleId,
          serviceType: dto.serviceType,
          performedAtOdometer: dto.performedAtOdometer,
          performedAtDate: new Date(dto.performedAtDate),
          cost: dto.cost,
          workshopName: dto.workshopName ?? null,
          invoicePhotoKey: dto.invoicePhotoKey ?? null,
          partsReplaced: dto.partsReplaced ?? null,
          notes: dto.notes ?? null,
          expenseId: expense.id,
          recordedById: user.userId,
        },
        include: serviceRecordInclude,
      });
    });

    // Keep the profile's odometer cache current if this service happened
    // further than any check has reported yet (workshop odometer is authoritative
    // for that moment — e.g. a check was skipped that day).
    const currentProfile = await this.prisma.vehicleProfile.findUnique({ where: { vehicleId: dto.vehicleId } });
    const nextOdometer = Math.max(dto.performedAtOdometer, currentProfile?.currentOdometer ?? 0);
    await this.prisma.vehicleProfile.upsert({
      where: { vehicleId: dto.vehicleId },
      create: { vendorId: user.vendorId, vehicleId: dto.vehicleId, currentOdometer: nextOdometer },
      update: { currentOdometer: nextOdometer },
    });

    await this.audit.log({
      vendorId: user.vendorId,
      userId: user.userId,
      userName: user.name,
      action: 'CREATED',
      entity: 'VehicleServiceRecord',
      entityId: record.id,
      changes: { after: record },
    });

    return record;
  }

  async listServiceRecords(vendorId: string, query: ServiceRecordQueryDto) {
    const { page = 1, limit = 20, vehicleId, serviceType } = query;
    const where: any = { vendorId };
    if (vehicleId) where.vehicleId = vehicleId;
    if (serviceType) where.serviceType = serviceType;

    const [data, total] = await Promise.all([
      this.prisma.vehicleServiceRecord.findMany({
        where,
        include: serviceRecordInclude,
        orderBy: { performedAtDate: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.vehicleServiceRecord.count({ where }),
    ]);

    return paginate(data, total, page, limit);
  }

  async getServiceRecord(vendorId: string, id: string) {
    const record = await this.prisma.vehicleServiceRecord.findFirst({
      where: { id, vendorId },
      include: serviceRecordInclude,
    });
    if (!record) throw new NotFoundException('Service record not found');
    return record;
  }

  async updateServiceRecord(user: AuthUser, id: string, dto: UpdateServiceRecordDto) {
    const record = await this.prisma.vehicleServiceRecord.findFirst({
      where: { id, vendorId: user.vendorId },
      include: { vehicle: { select: { id: true, plateNumber: true } } },
    });
    if (!record) throw new NotFoundException('Service record not found');
    const serviceLabel =
      dto.serviceType !== undefined ? await this.serviceTypes.assertKeyExists(user.vendorId, dto.serviceType) : null;

    const updated = await this.prisma.$transaction(async (tx) => {
      if (
        record.expenseId &&
        (dto.cost !== undefined || dto.performedAtDate !== undefined || dto.serviceType !== undefined)
      ) {
        await tx.expense.update({
          where: { id: record.expenseId },
          data: {
            ...(dto.cost !== undefined && { amount: dto.cost }),
            ...(dto.performedAtDate !== undefined && { date: new Date(dto.performedAtDate) }),
            ...(dto.serviceType !== undefined && {
              description: `${serviceLabel} — ${record.vehicle.plateNumber}`,
            }),
          },
        });
      }

      return tx.vehicleServiceRecord.update({
        where: { id },
        data: {
          ...(dto.serviceType !== undefined && { serviceType: dto.serviceType }),
          ...(dto.performedAtOdometer !== undefined && { performedAtOdometer: dto.performedAtOdometer }),
          ...(dto.performedAtDate !== undefined && { performedAtDate: new Date(dto.performedAtDate) }),
          ...(dto.cost !== undefined && { cost: dto.cost }),
          ...(dto.workshopName !== undefined && { workshopName: dto.workshopName }),
          ...(dto.invoicePhotoKey !== undefined && { invoicePhotoKey: dto.invoicePhotoKey }),
          ...(dto.partsReplaced !== undefined && { partsReplaced: dto.partsReplaced }),
          ...(dto.notes !== undefined && { notes: dto.notes }),
        },
        include: serviceRecordInclude,
      });
    });

    await this.audit.log({
      vendorId: user.vendorId,
      userId: user.userId,
      userName: user.name,
      action: 'UPDATED',
      entity: 'VehicleServiceRecord',
      entityId: id,
      changes: { before: record, after: updated },
    });

    return updated;
  }

  async removeServiceRecord(user: AuthUser, id: string) {
    const record = await this.prisma.vehicleServiceRecord.findFirst({ where: { id, vendorId: user.vendorId } });
    if (!record) throw new NotFoundException('Service record not found');

    await this.prisma.$transaction(async (tx) => {
      await tx.vehicleServiceRecord.delete({ where: { id } });
      if (record.expenseId) {
        await tx.expense.delete({ where: { id: record.expenseId } });
      }
    });

    await this.audit.log({
      vendorId: user.vendorId,
      userId: user.userId,
      userName: user.name,
      action: 'DELETED',
      entity: 'VehicleServiceRecord',
      entityId: id,
      changes: { before: record },
    });

    return { deleted: true };
  }
}
