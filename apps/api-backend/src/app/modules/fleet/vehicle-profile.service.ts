import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { AuditService } from '../audit/audit.service';
import { paginate } from '../../common/helpers/paginate';
import type { AuthUser } from '@water-supply-crm/types';
import { UpdateVehicleProfileDto } from './dto/update-vehicle-profile.dto';
import { CreateVehicleDocumentDto } from './dto/create-vehicle-document.dto';
import { UpdateVehicleDocumentDto } from './dto/update-vehicle-document.dto';
import { VehicleQueryDto } from './dto/vehicle-query.dto';

@Injectable()
export class VehicleProfileService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  /** Vehicle list with a light per-vehicle summary — full maintenance detail lives under /fleet/maintenance. */
  async findAll(vendorId: string, query: VehicleQueryDto) {
    const { page = 1, limit = 20, search, operationalStatus } = query;

    const vanWhere: any = { vendorId };
    if (search) vanWhere.plateNumber = { contains: search, mode: 'insensitive' };
    if (operationalStatus) vanWhere.vehicleProfile = { operationalStatus };

    const [vans, total] = await Promise.all([
      this.prisma.van.findMany({
        where: vanWhere,
        include: {
          defaultDriver: { select: { id: true, name: true } },
          vehicleProfile: true,
        },
        orderBy: { plateNumber: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.van.count({ where: vanWhere }),
    ]);

    const vanIds = vans.map((v) => v.id);
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const [expiringDocs, monthCosts] = await Promise.all([
      this.prisma.vehicleDocument.groupBy({
        by: ['vanId'],
        where: {
          vendorId,
          vanId: { in: vanIds },
          isActive: true,
          expiryDate: { not: null, lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
        },
        _count: { id: true },
      }),
      this.prisma.expense.groupBy({
        by: ['vanId'],
        where: { vendorId, vanId: { in: vanIds }, date: { gte: monthStart } },
        _sum: { amount: true },
      }),
    ]);
    const expiringByVan = new Map(expiringDocs.map((d) => [d.vanId, d._count.id]));
    const costByVan = new Map(monthCosts.map((c) => [c.vanId as string, c._sum.amount ?? 0]));

    const data = vans.map((van) => ({
      id: van.id,
      plateNumber: van.plateNumber,
      isActive: van.isActive,
      defaultDriver: van.defaultDriver,
      profile: van.vehicleProfile,
      expiringDocumentCount: expiringByVan.get(van.id) ?? 0,
      costThisMonth: costByVan.get(van.id) ?? 0,
    }));

    return paginate(data, total, page, limit);
  }

  async findOne(vendorId: string, vanId: string) {
    const van = await this.prisma.van.findFirst({
      where: { id: vanId, vendorId },
      include: {
        defaultDriver: { select: { id: true, name: true } },
        vehicleProfile: true,
        vehicleDocuments: {
          where: { isActive: true },
          orderBy: { expiryDate: 'asc' },
          include: { createdBy: { select: { id: true, name: true } } },
        },
      },
    });
    if (!van) throw new NotFoundException('Vehicle not found');
    return van;
  }

  /** Upserts the profile — a Van may not have a VehicleProfile row yet (plan doc §4). */
  async updateProfile(user: AuthUser, vanId: string, dto: UpdateVehicleProfileDto) {
    const van = await this.prisma.van.findFirst({ where: { id: vanId, vendorId: user.vendorId } });
    if (!van) throw new NotFoundException('Vehicle not found');

    const existing = await this.prisma.vehicleProfile.findUnique({ where: { vanId } });

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
        data: { vendorId: user.vendorId, vanId, ...fields },
      });
    } else {
      if (dto.version === undefined) {
        throw new BadRequestException('version is required when updating an existing vehicle profile.');
      }
      const result = await this.prisma.vehicleProfile.updateMany({
        where: { vanId, version: dto.version },
        data: { ...fields, version: { increment: 1 } },
      });
      if (result.count === 0) {
        throw new ConflictException(
          `Version mismatch: expected ${dto.version}, but the profile has changed. Reload and retry.`,
        );
      }
      profile = await this.prisma.vehicleProfile.findUnique({ where: { vanId } });
    }

    await this.audit.log({
      vendorId: user.vendorId,
      userId: user.userId,
      userName: user.name,
      action: existing ? 'UPDATED' : 'CREATED',
      entity: 'VehicleProfile',
      entityId: vanId,
      changes: { before: existing, after: profile },
    });

    return profile;
  }

  async addDocument(user: AuthUser, vanId: string, dto: CreateVehicleDocumentDto) {
    const van = await this.prisma.van.findFirst({ where: { id: vanId, vendorId: user.vendorId } });
    if (!van) throw new NotFoundException('Vehicle not found');

    const document = await this.prisma.vehicleDocument.create({
      data: {
        vendorId: user.vendorId,
        vanId,
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
