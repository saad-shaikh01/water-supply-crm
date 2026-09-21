import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import type { AuthUser } from '@water-supply-crm/types';
import { AuditService } from '../audit/audit.service';
import { CreateLabourTypeDto } from './dto/create-labour-type.dto';
import { UpdateLabourTypeDto } from './dto/update-labour-type.dto';

const DEFAULT_TYPES = [
  { name: 'Loader', isSystem: false },
  { name: 'Helper', isSystem: false },
  { name: 'Driver', isSystem: false },
  { name: 'Mechanic', isSystem: false },
  { name: 'Cleaner', isSystem: false },
  { name: 'Other', isSystem: true },
];

@Injectable()
export class ExtraLabourTypeService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  async ensureSeeded(vendorId: string): Promise<void> {
    const count = await this.prisma.extraLabourType.count({ where: { vendorId } });
    if (count > 0) return;

    await this.prisma.extraLabourType.createMany({
      data: DEFAULT_TYPES.map((t) => ({
        vendorId,
        name: t.name,
        isSystem: t.isSystem,
      })),
      skipDuplicates: true,
    });
  }

  async listTypes(vendorId: string) {
    await this.ensureSeeded(vendorId);

    const types = await this.prisma.extraLabourType.findMany({
      where: { vendorId },
      orderBy: { createdAt: 'asc' },
    });

    const counts = await this.prisma.extraLabour.groupBy({
      by: ['labourTypeId'],
      where: { vendorId },
      _count: { _all: true },
    });

    const countMap = new Map(counts.map((c) => [c.labourTypeId, c._count._all]));

    return types.map((t) => ({
      id: t.id,
      name: t.name,
      isSystem: t.isSystem,
      inUseCount: countMap.get(t.id) ?? 0,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    }));
  }

  async createType(user: AuthUser, dto: CreateLabourTypeDto) {
    await this.ensureSeeded(user.vendorId);
    const trimmed = dto.name.trim();

    const existing = await this.prisma.extraLabourType.findFirst({
      where: {
        vendorId: user.vendorId,
        name: { equals: trimmed, mode: 'insensitive' },
      },
    });

    if (existing) {
      throw new ConflictException(`Labour type "${trimmed}" already exists`);
    }

    const type = await this.prisma.extraLabourType.create({
      data: {
        vendorId: user.vendorId,
        name: trimmed,
        isSystem: false,
      },
    });

    await this.audit.log({
      vendorId: user.vendorId,
      userId: user.userId,
      userName: user.name,
      action: 'CREATED',
      entity: 'ExtraLabourType',
      entityId: type.id,
      changes: { after: type },
    });

    return type;
  }

  async updateType(user: AuthUser, id: string, dto: UpdateLabourTypeDto) {
    const type = await this.prisma.extraLabourType.findFirst({
      where: { id, vendorId: user.vendorId },
    });

    if (!type) {
      throw new NotFoundException('Extra labour type not found');
    }

    const trimmed = dto.name.trim();
    if (type.name.toLowerCase() !== trimmed.toLowerCase()) {
      const existing = await this.prisma.extraLabourType.findFirst({
        where: {
          vendorId: user.vendorId,
          name: { equals: trimmed, mode: 'insensitive' },
          id: { not: id },
        },
      });
      if (existing) {
        throw new ConflictException(`Labour type "${trimmed}" already exists`);
      }
    }

    const updated = await this.prisma.extraLabourType.update({
      where: { id },
      data: { name: trimmed },
    });

    await this.audit.log({
      vendorId: user.vendorId,
      userId: user.userId,
      userName: user.name,
      action: 'UPDATED',
      entity: 'ExtraLabourType',
      entityId: id,
      changes: { before: type, after: updated },
    });

    return updated;
  }

  async deleteType(user: AuthUser, id: string) {
    const type = await this.prisma.extraLabourType.findFirst({
      where: { id, vendorId: user.vendorId },
    });

    if (!type) {
      throw new NotFoundException('Extra labour type not found');
    }

    if (type.isSystem) {
      throw new BadRequestException('System labour type cannot be deleted');
    }

    const inUseCount = await this.prisma.extraLabour.count({
      where: { labourTypeId: id },
    });

    if (inUseCount > 0) {
      throw new ConflictException('Labour type is in use by extra labour entries');
    }

    await this.prisma.extraLabourType.delete({
      where: { id },
    });

    await this.audit.log({
      vendorId: user.vendorId,
      userId: user.userId,
      userName: user.name,
      action: 'DELETED',
      entity: 'ExtraLabourType',
      entityId: id,
      changes: { before: type },
    });

    return { success: true };
  }
}
