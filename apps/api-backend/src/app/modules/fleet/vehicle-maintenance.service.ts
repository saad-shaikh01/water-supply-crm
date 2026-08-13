import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { ExpenseCategory, VehicleServiceType } from '@prisma/client';
import { VEHICLE_MAINTENANCE_DEFAULT_INTERVALS, VEHICLE_SERVICE_TYPE_LABELS } from '@water-supply-crm/types';
import { paginate } from '../../common/helpers/paginate';
import type { AuthUser } from '@water-supply-crm/types';
import { AuditService } from '../audit/audit.service';
import { UpdateMaintenanceRuleDto } from './dto/update-maintenance-rule.dto';
import { CreateServiceRecordDto } from './dto/create-service-record.dto';
import { ServiceRecordQueryDto } from './dto/service-record-query.dto';
import { computeMaintenanceStatus } from './fleet-maintenance.util';

const serviceRecordInclude = {
  recordedBy: { select: { id: true, name: true } },
  van: { select: { id: true, plateNumber: true } },
};

@Injectable()
export class VehicleMaintenanceService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  /**
   * Seeds VEHICLE_MAINTENANCE_DEFAULT_INTERVALS onto a vehicle the first time
   * its maintenance list is opened. Always per-vehicle (no separate vendor-wide
   * default row — see schema comment on VehicleMaintenanceRule).
   */
  async ensureDefaultRules(vendorId: string, vanId: string): Promise<void> {
    const existingCount = await this.prisma.vehicleMaintenanceRule.count({ where: { vanId } });
    if (existingCount > 0) return;

    await this.prisma.vehicleMaintenanceRule.createMany({
      data: (Object.keys(VEHICLE_MAINTENANCE_DEFAULT_INTERVALS) as VehicleServiceType[]).map((serviceType) => ({
        vendorId,
        vanId,
        serviceType,
        intervalKm: VEHICLE_MAINTENANCE_DEFAULT_INTERVALS[serviceType].intervalKm,
        intervalDays: VEHICLE_MAINTENANCE_DEFAULT_INTERVALS[serviceType].intervalDays,
      })),
      skipDuplicates: true,
    });
  }

  async getStatusForVan(vendorId: string, vanId: string) {
    const van = await this.prisma.van.findFirst({
      where: { id: vanId, vendorId },
      include: { vehicleProfile: true },
    });
    if (!van) throw new NotFoundException('Vehicle not found');

    await this.ensureDefaultRules(vendorId, vanId);

    const rules = await this.prisma.vehicleMaintenanceRule.findMany({
      where: { vanId, isActive: true },
      orderBy: { serviceType: 'asc' },
    });

    const latestRecords = await this.prisma.vehicleServiceRecord.findMany({
      where: { vanId },
      distinct: ['serviceType'],
      orderBy: { performedAtDate: 'desc' },
    });
    const latestByType = new Map(latestRecords.map((r) => [r.serviceType, r]));

    const currentOdometer = van.vehicleProfile?.currentOdometer ?? 0;
    const baselineDate = van.vehicleProfile?.createdAt ?? van.createdAt;

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
        vanId,
        serviceType: rule.serviceType,
        label: VEHICLE_SERVICE_TYPE_LABELS[rule.serviceType],
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
    const vans = await this.prisma.van.findMany({
      where: { vendorId, isActive: true },
      select: { id: true, plateNumber: true },
    });

    const results = await Promise.all(
      vans.map(async (van) => {
        const statuses = await this.getStatusForVan(vendorId, van.id);
        return {
          vanId: van.id,
          plateNumber: van.plateNumber,
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
    const van = await this.prisma.van.findFirst({ where: { id: dto.vanId, vendorId: user.vendorId } });
    if (!van) throw new NotFoundException('Vehicle not found');

    const record = await this.prisma.$transaction(async (tx) => {
      const expense = await tx.expense.create({
        data: {
          vendorId: user.vendorId,
          category: ExpenseCategory.VEHICLE_MAINTENANCE,
          amount: dto.cost,
          description: `${VEHICLE_SERVICE_TYPE_LABELS[dto.serviceType]} — ${van.plateNumber}`,
          date: new Date(dto.performedAtDate),
          vanId: dto.vanId,
          createdById: user.userId,
        },
      });

      return tx.vehicleServiceRecord.create({
        data: {
          vendorId: user.vendorId,
          vanId: dto.vanId,
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
    const currentProfile = await this.prisma.vehicleProfile.findUnique({ where: { vanId: dto.vanId } });
    const nextOdometer = Math.max(dto.performedAtOdometer, currentProfile?.currentOdometer ?? 0);
    await this.prisma.vehicleProfile.upsert({
      where: { vanId: dto.vanId },
      create: { vendorId: user.vendorId, vanId: dto.vanId, currentOdometer: nextOdometer },
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
    const { page = 1, limit = 20, vanId, serviceType } = query;
    const where: any = { vendorId };
    if (vanId) where.vanId = vanId;
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
}
