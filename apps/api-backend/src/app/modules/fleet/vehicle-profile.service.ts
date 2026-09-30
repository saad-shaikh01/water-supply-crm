import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { AuditService } from '../audit/audit.service';
import { paginate } from '../../common/helpers/paginate';
import type { AuthUser } from '@water-supply-crm/types';
import { UpdateVehicleProfileDto } from './dto/update-vehicle-profile.dto';
import { CreateVehicleDocumentDto } from './dto/create-vehicle-document.dto';
import { UpdateVehicleDocumentDto } from './dto/update-vehicle-document.dto';
import { VehicleQueryDto } from './dto/vehicle-query.dto';
import { VehicleCostService, type VehiclePeriodStats } from './vehicle-cost.service';
import { currentMonthKey } from './fleet-period.util';

@Injectable()
export class VehicleProfileService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private cost: VehicleCostService,
  ) {}

  /**
   * Vehicle list with a light per-vehicle summary — full maintenance detail
   * lives under /fleet/maintenance. Re-keyed from Van to Vehicle by the §17
   * Amendment (2026-08-21); this list also doubles as the vehicle-picker
   * source for the Vehicle Check start form (§17.3) via `?active=true`.
   */
  async findAll(vendorId: string, query: VehicleQueryDto) {
    const { page = 1, limit = 20, search, operationalStatus, active } = query;

    const vehicleWhere: any = { vendorId };
    if (search) vehicleWhere.plateNumber = { contains: search, mode: 'insensitive' };
    if (operationalStatus) vehicleWhere.vehicleProfile = { operationalStatus };
    if (active !== undefined) vehicleWhere.isActive = active === 'true' || (active as unknown) === true;

    if (query.month) return this.findAllWithPeriod(vendorId, query, vehicleWhere);

    const [vehicles, total] = await Promise.all([
      this.prisma.vehicle.findMany({
        where: vehicleWhere,
        include: {
          usualVan: { select: { id: true, defaultDriver: { select: { id: true, name: true } } } },
          vehicleProfile: true,
        },
        orderBy: { plateNumber: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.vehicle.count({ where: vehicleWhere }),
    ]);

    const vehicleIds = vehicles.map((v) => v.id);
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    // Vehicle-specific costs only (fuel + maintenance) — Expense itself stays
    // vanId/route-level (§17.2), so it cannot be attributed to a specific
    // vehicle here; see fleet-dashboard.service.ts for the same judgment call.
    const [expiringDocs, fuelCosts, serviceCosts] = await Promise.all([
      this.prisma.vehicleDocument.groupBy({
        by: ['vehicleId'],
        where: {
          vendorId,
          vehicleId: { in: vehicleIds },
          isActive: true,
          expiryDate: { not: null, lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
        },
        _count: { id: true },
      }),
      this.prisma.fuelLog.groupBy({
        by: ['vehicleId'],
        where: { vendorId, vehicleId: { in: vehicleIds }, date: { gte: monthStart } },
        _sum: { amountPaid: true },
      }),
      this.prisma.vehicleServiceRecord.groupBy({
        by: ['vehicleId'],
        where: { vendorId, vehicleId: { in: vehicleIds }, performedAtDate: { gte: monthStart } },
        _sum: { cost: true },
      }),
    ]);
    const expiringByVehicle = new Map(expiringDocs.map((d) => [d.vehicleId, d._count.id]));
    const fuelCostByVehicle = new Map(fuelCosts.map((c) => [c.vehicleId, c._sum.amountPaid ?? 0]));
    const serviceCostByVehicle = new Map(serviceCosts.map((c) => [c.vehicleId, c._sum.cost ?? 0]));

    const data = vehicles.map((vehicle) => ({
      id: vehicle.id,
      plateNumber: vehicle.plateNumber,
      isActive: vehicle.isActive,
      usualVanId: vehicle.usualVanId,
      usualVanDefaultDriver: vehicle.usualVan?.defaultDriver ?? null,
      profile: vehicle.vehicleProfile,
      expiringDocumentCount: expiringByVehicle.get(vehicle.id) ?? 0,
      costThisMonth: (fuelCostByVehicle.get(vehicle.id) ?? 0) + (serviceCostByVehicle.get(vehicle.id) ?? 0),
    }));

    return paginate(data, total, page, limit);
  }

  /**
   * Fleet list page path (`?month=YYYY-MM`): the fleet is small (tens of
   * vehicles), so stats are computed for every matching vehicle first so the
   * page can sort by a computed column (cost, cost/km, km) server-side, then
   * the requested page is sliced. `meta.totals` covers the whole filtered set.
   */
  private async findAllWithPeriod(vendorId: string, query: VehicleQueryDto, vehicleWhere: any) {
    const { page = 1, limit = 20, month = currentMonthKey(), sortBy = 'plateNumber', sortDir } = query;

    const vehicles = await this.prisma.vehicle.findMany({
      where: vehicleWhere,
      include: {
        usualVan: { select: { id: true, defaultDriver: { select: { id: true, name: true } } } },
        vehicleProfile: true,
      },
      orderBy: { plateNumber: 'asc' },
    });
    const vehicleIds = vehicles.map((v) => v.id);
    const [stats, expiringDocs] = await Promise.all([
      this.cost.getStatsForMonth(vendorId, vehicleIds, month),
      this.prisma.vehicleDocument.groupBy({
        by: ['vehicleId'],
        where: {
          vendorId,
          vehicleId: { in: vehicleIds },
          isActive: true,
          expiryDate: { not: null, lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
        },
        _count: { id: true },
      }),
    ]);
    const expiringByVehicle = new Map(expiringDocs.map((d) => [d.vehicleId, d._count.id]));

    const rows = vehicles.map((vehicle) => {
      const period = stats.get(vehicle.id) as VehiclePeriodStats;
      return {
        id: vehicle.id,
        plateNumber: vehicle.plateNumber,
        isActive: vehicle.isActive,
        usualVanId: vehicle.usualVanId,
        usualVanDefaultDriver: vehicle.usualVan?.defaultDriver ?? null,
        profile: vehicle.vehicleProfile,
        expiringDocumentCount: expiringByVehicle.get(vehicle.id) ?? 0,
        costThisMonth: period.totalCost,
        period,
      };
    });

    const dir = (sortDir ?? (sortBy === 'plateNumber' ? 'asc' : 'desc')) === 'asc' ? 1 : -1;
    const sortValue = (r: (typeof rows)[number]): string | number | null =>
      sortBy === 'plateNumber' ? r.plateNumber : r.period[sortBy];
    rows.sort((a, b) => {
      const av = sortValue(a);
      const bv = sortValue(b);
      // Nulls (e.g. no km => no cost/km) always sink to the bottom.
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return (av < bv ? -1 : av > bv ? 1 : 0) * dir;
    });

    const sum = (pick: (p: VehiclePeriodStats) => number) => rows.reduce((t, r) => t + pick(r.period), 0);
    const totalKm = sum((p) => p.kmDriven);
    const totalCost = sum((p) => p.totalCost);
    const result = paginate(rows.slice((page - 1) * limit, page * limit), rows.length, page, limit);
    return {
      ...result,
      meta: {
        ...result.meta,
        month,
        totals: {
          fuelCost: sum((p) => p.fuelCost),
          fuelLiters: sum((p) => p.fuelLiters),
          maintenanceCost: sum((p) => p.maintenanceCost),
          otherCost: sum((p) => p.otherCost),
          totalCost,
          kmDriven: totalKm,
          costPerKm: totalKm > 0 ? totalCost / totalKm : null,
        },
      },
    };
  }

  async findOne(vendorId: string, vehicleId: string) {
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id: vehicleId, vendorId },
      include: {
        usualVan: { select: { id: true, defaultDriver: { select: { id: true, name: true } } } },
        vehicleProfile: true,
        vehicleDocuments: {
          where: { isActive: true },
          orderBy: { expiryDate: 'asc' },
          include: { createdBy: { select: { id: true, name: true } } },
        },
      },
    });
    if (!vehicle) throw new NotFoundException('Vehicle not found');
    return vehicle;
  }

  /** Upserts the profile — a Vehicle may not have a VehicleProfile row yet (plan doc §4). */
  async updateProfile(user: AuthUser, vehicleId: string, dto: UpdateVehicleProfileDto) {
    const vehicle = await this.prisma.vehicle.findFirst({ where: { id: vehicleId, vendorId: user.vendorId } });
    if (!vehicle) throw new NotFoundException('Vehicle not found');

    const existing = await this.prisma.vehicleProfile.findUnique({ where: { vehicleId } });

    const fields = {
      ...(dto.make !== undefined && { make: dto.make }),
      ...(dto.model !== undefined && { model: dto.model }),
      ...(dto.year !== undefined && { year: dto.year }),
      ...(dto.color !== undefined && { color: dto.color }),
      ...(dto.chassisNumber !== undefined && { chassisNumber: dto.chassisNumber }),
      ...(dto.engineNumber !== undefined && { engineNumber: dto.engineNumber }),
      ...(dto.fuelType !== undefined && { fuelType: dto.fuelType }),
      ...(dto.transmissionType !== undefined && { transmissionType: dto.transmissionType }),
      ...(dto.loadCapacityKg !== undefined && { loadCapacityKg: dto.loadCapacityKg }),
      ...(dto.seatingCapacity !== undefined && { seatingCapacity: dto.seatingCapacity }),
      ...(dto.ownershipType !== undefined && { ownershipType: dto.ownershipType }),
      ...(dto.purchaseDate !== undefined && { purchaseDate: new Date(dto.purchaseDate) }),
      ...(dto.purchaseCost !== undefined && { purchaseCost: dto.purchaseCost }),
      ...(dto.supplierName !== undefined && { supplierName: dto.supplierName }),
      ...(dto.operationalStatus !== undefined && { operationalStatus: dto.operationalStatus }),
    };

    let profile;
    if (!existing) {
      profile = await this.prisma.vehicleProfile.create({
        data: { vendorId: user.vendorId, vehicleId, ...fields },
      });
    } else {
      if (dto.version === undefined) {
        throw new BadRequestException('version is required when updating an existing vehicle profile.');
      }
      const result = await this.prisma.vehicleProfile.updateMany({
        where: { vehicleId, version: dto.version },
        data: { ...fields, version: { increment: 1 } },
      });
      if (result.count === 0) {
        throw new ConflictException(
          `Version mismatch: expected ${dto.version}, but the profile has changed. Reload and retry.`,
        );
      }
      profile = await this.prisma.vehicleProfile.findUnique({ where: { vehicleId } });
    }

    await this.audit.log({
      vendorId: user.vendorId,
      userId: user.userId,
      userName: user.name,
      action: existing ? 'UPDATED' : 'CREATED',
      entity: 'VehicleProfile',
      entityId: vehicleId,
      changes: { before: existing, after: profile },
    });

    return profile;
  }

  async addDocument(user: AuthUser, vehicleId: string, dto: CreateVehicleDocumentDto) {
    const vehicle = await this.prisma.vehicle.findFirst({ where: { id: vehicleId, vendorId: user.vendorId } });
    if (!vehicle) throw new NotFoundException('Vehicle not found');

    const document = await this.prisma.vehicleDocument.create({
      data: {
        vendorId: user.vendorId,
        vehicleId,
        type: dto.type,
        documentNumber: dto.documentNumber ?? null,
        issuingAuthority: dto.issuingAuthority ?? null,
        issueDate: dto.issueDate ? new Date(dto.issueDate) : null,
        expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : null,
        fileKey: dto.fileKey ?? null,
        reminderDaysBefore: dto.reminderDaysBefore ?? 30,
        notes: dto.notes ?? null,
        createdById: user.userId,
      },
    });

    await this.audit.log({
      vendorId: user.vendorId,
      userId: user.userId,
      userName: user.name,
      action: 'CREATED',
      entity: 'VehicleDocument',
      entityId: document.id,
      changes: { after: document },
    });

    return document;
  }

  async updateDocument(user: AuthUser, id: string, dto: UpdateVehicleDocumentDto) {
    const document = await this.prisma.vehicleDocument.findFirst({ where: { id, vendorId: user.vendorId } });
    if (!document) throw new NotFoundException('Document not found');

    const updated = await this.prisma.vehicleDocument.update({
      where: { id },
      data: {
        ...(dto.type !== undefined && { type: dto.type }),
        ...(dto.documentNumber !== undefined && { documentNumber: dto.documentNumber }),
        ...(dto.issuingAuthority !== undefined && { issuingAuthority: dto.issuingAuthority }),
        ...(dto.issueDate !== undefined && { issueDate: dto.issueDate ? new Date(dto.issueDate) : null }),
        ...(dto.expiryDate !== undefined && { expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : null }),
        ...(dto.fileKey !== undefined && { fileKey: dto.fileKey }),
        ...(dto.reminderDaysBefore !== undefined && { reminderDaysBefore: dto.reminderDaysBefore }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
      },
    });

    await this.audit.log({
      vendorId: user.vendorId,
      userId: user.userId,
      userName: user.name,
      action: 'UPDATED',
      entity: 'VehicleDocument',
      entityId: id,
      changes: { before: document, after: updated },
    });

    return updated;
  }

  /** Soft-retire — keeps document history for audit (e.g. a superseded insurance policy). */
  async deactivateDocument(user: AuthUser, id: string) {
    const document = await this.prisma.vehicleDocument.findFirst({ where: { id, vendorId: user.vendorId } });
    if (!document) throw new NotFoundException('Document not found');

    const updated = await this.prisma.vehicleDocument.update({ where: { id }, data: { isActive: false } });

    await this.audit.log({
      vendorId: user.vendorId,
      userId: user.userId,
      userName: user.name,
      action: 'DEACTIVATED',
      entity: 'VehicleDocument',
      entityId: id,
    });

    return updated;
  }
}
