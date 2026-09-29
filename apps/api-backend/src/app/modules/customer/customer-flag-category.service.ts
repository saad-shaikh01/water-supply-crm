import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import type { AuthUser } from '@water-supply-crm/types';
import { AuditService } from '../audit/audit.service';
import { CreateCustomerFlagCategoryDto } from './dto/create-customer-flag-category.dto';
import { UpdateCustomerFlagCategoryDto } from './dto/update-customer-flag-category.dto';

/**
 * Per-vendor, admin-managed catalogue of customer-flag categories (e.g. "To
 * Be Closed", "Payment Overdue") behind the flag/resolve flow on
 * `CustomerFlagService` — see the schema comment on `CustomerFlagCategory`.
 * Mirrors `AttendanceCategoryService`'s "add / edit / delete only if unused"
 * shape, extended with `color` + `defaultMessage` since a flag category also
 * drives a badge's appearance and pre-filled reason text, not just a name.
 */
@Injectable()
export class CustomerFlagCategoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(vendorId: string) {
    const categories = await this.prisma.customerFlagCategory.findMany({
      where: { vendorId },
      orderBy: { name: 'asc' },
    });
    const usage = await this.prisma.customerFlag.groupBy({
      by: ['categoryId'],
      where: { vendorId, status: 'OPEN' },
      _count: { _all: true },
    });
    const usageById = new Map(usage.map((u) => [u.categoryId, u._count._all]));

    return categories.map((c) => ({ ...c, activeFlagCount: usageById.get(c.id) ?? 0 }));
  }

  async create(user: AuthUser, dto: CreateCustomerFlagCategoryDto) {
    const name = dto.name.replace(/\s+/g, ' ').trim();
    if (name.length < 2) throw new BadRequestException('Category name is too short');

    const duplicate = await this.prisma.customerFlagCategory.findFirst({
      where: { vendorId: user.vendorId, name: { equals: name, mode: 'insensitive' } },
    });
    if (duplicate) throw new ConflictException(`A category named "${duplicate.name}" already exists`);

    const created = await this.prisma.customerFlagCategory.create({
      data: {
        vendorId: user.vendorId,
        name,
        color: dto.color,
        defaultMessage: dto.defaultMessage?.trim() || null,
      },
    });

    await this.audit.log({
      vendorId: user.vendorId,
      userId: user.userId,
      userName: user.name,
      action: 'CREATED',
      entity: 'CustomerFlagCategory',
      entityId: created.id,
      changes: { after: created },
    });

    return { ...created, activeFlagCount: 0 };
  }

  async update(user: AuthUser, id: string, dto: UpdateCustomerFlagCategoryDto) {
    const category = await this.prisma.customerFlagCategory.findFirst({ where: { id, vendorId: user.vendorId } });
    if (!category) throw new NotFoundException('Category not found');

    let name = category.name;
    if (dto.name !== undefined) {
      name = dto.name.replace(/\s+/g, ' ').trim();
      if (name.length < 2) throw new BadRequestException('Category name is too short');
      const duplicate = await this.prisma.customerFlagCategory.findFirst({
        where: { vendorId: user.vendorId, name: { equals: name, mode: 'insensitive' }, id: { not: id } },
      });
      if (duplicate) throw new ConflictException(`A category named "${duplicate.name}" already exists`);
    }

    const updated = await this.prisma.customerFlagCategory.update({
      where: { id },
      data: {
        name,
        color: dto.color ?? category.color,
        defaultMessage: dto.defaultMessage !== undefined ? dto.defaultMessage?.trim() || null : category.defaultMessage,
        isActive: dto.isActive ?? category.isActive,
      },
    });

    await this.audit.log({
      vendorId: user.vendorId,
      userId: user.userId,
      userName: user.name,
      action: 'UPDATED',
      entity: 'CustomerFlagCategory',
      entityId: updated.id,
      changes: { before: category, after: updated },
    });

    return updated;
  }

  async remove(user: AuthUser, id: string) {
    const category = await this.prisma.customerFlagCategory.findFirst({ where: { id, vendorId: user.vendorId } });
    if (!category) throw new NotFoundException('Category not found');

    const used = await this.prisma.customerFlag.count({ where: { vendorId: user.vendorId, categoryId: id } });
    if (used > 0) {
      throw new ConflictException(
        `"${category.name}" is used on ${used} flag${used === 1 ? '' : 's'} (active or resolved) and cannot be removed — deactivate it instead`,
      );
    }

    await this.prisma.customerFlagCategory.delete({ where: { id } });

    await this.audit.log({
      vendorId: user.vendorId,
      userId: user.userId,
      userName: user.name,
      action: 'DELETED',
      entity: 'CustomerFlagCategory',
      entityId: category.id,
      changes: { before: category },
    });

    return { deleted: true };
  }
}
