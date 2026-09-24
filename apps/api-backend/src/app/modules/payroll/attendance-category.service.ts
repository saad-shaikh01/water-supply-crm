import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import type { Prisma } from '@prisma/client';
import type { AuthUser } from '@water-supply-crm/types';
import { AuditService } from '../audit/audit.service';
import { CreateAttendanceCategoryDto } from './dto/create-attendance-category.dto';

/**
 * Per-vendor, admin-managed reason catalogue behind the "why was this a
 * manual PRESENT" requirement on `StaffAttendanceService.markStatus` — see
 * the schema comment on `StaffAttendance.categoryId`. Mirrors
 * `VehicleServiceTypeService`'s "add custom / delete only if unused" shape,
 * simplified: no built-ins to seed, and `categoryId` is a real FK (no
 * historical enum value to preserve as a string), so deletion just checks
 * `StaffAttendance` usage directly instead of a separate rules table.
 */
@Injectable()
export class AttendanceCategoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(vendorId: string) {
    const categories = await this.prisma.attendanceCategory.findMany({
      where: { vendorId },
      orderBy: { name: 'asc' },
    });
    const usage = await this.prisma.staffAttendance.groupBy({
      by: ['categoryId'],
      where: { vendorId, categoryId: { not: null } },
      _count: { _all: true },
    });
    const usageById = new Map(usage.map((u) => [u.categoryId as string, u._count._all]));

    return categories.map((c) => ({ ...c, usageCount: usageById.get(c.id) ?? 0 }));
  }

  async create(user: AuthUser, dto: CreateAttendanceCategoryDto) {
    const name = dto.name.replace(/\s+/g, ' ').trim();
    if (name.length < 2) throw new BadRequestException('Category name is too short');

    const duplicate = await this.prisma.attendanceCategory.findFirst({
      where: { vendorId: user.vendorId, name: { equals: name, mode: 'insensitive' } },
    });
    if (duplicate) throw new ConflictException(`A category named "${duplicate.name}" already exists`);

    const created = await this.prisma.attendanceCategory.create({
      data: { vendorId: user.vendorId, name },
    });

    await this.audit.log({
      vendorId: user.vendorId,
      userId: user.userId,
      userName: user.name,
      action: 'CREATED',
      entity: 'AttendanceCategory',
      entityId: created.id,
      changes: { after: created },
    });

    return { ...created, usageCount: 0 };
  }

  async remove(user: AuthUser, id: string) {
    const category = await this.prisma.attendanceCategory.findFirst({ where: { id, vendorId: user.vendorId } });
    if (!category) throw new NotFoundException('Category not found');

    const used = await this.prisma.staffAttendance.count({ where: { vendorId: user.vendorId, categoryId: id } });
    if (used > 0) {
      throw new ConflictException(
        `"${category.name}" is used on ${used} attendance record${used === 1 ? '' : 's'} and cannot be removed`,
      );
    }

    await this.prisma.attendanceCategory.delete({ where: { id } });

    await this.audit.log({
      vendorId: user.vendorId,
      userId: user.userId,
      userName: user.name,
      action: 'DELETED',
      entity: 'AttendanceCategory',
      entityId: category.id,
      changes: { before: category },
    });

    return { deleted: true };
  }

  /**
   * Throws 400 unless `id` is an active category for this vendor. Takes an
   * optional transaction client so `StaffAttendanceService.markStatus` can
   * compose this check into its own `$transaction` instead of racing it.
   */
  async assertExists(
    vendorId: string,
    id: string,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<void> {
    const category = await client.attendanceCategory.findFirst({ where: { id, vendorId, isActive: true } });
    if (!category) throw new BadRequestException('Unknown attendance category');
  }
}
