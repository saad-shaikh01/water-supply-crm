import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import type { AuthUser } from '@water-supply-crm/types';
import { CreateSalaryStructureDto } from './dto/create-salary-structure.dto';
import { PayFrequency, Prisma } from '@prisma/client';
import { assertCanViewEmployeePayroll } from '../../common/helpers/payroll-view-scope.util';
import { PermissionService } from '../authz/permission.service';

/**
 * Versioned recurring baseline salary per employee (§ schema module note,
 * SalaryStructure). A rate change is always a NEW row — the previous row is
 * never edited in place beyond closing its `effectiveTo`, mirroring the
 * append-only intent shared with StaffLedgerEntry.
 */
@Injectable()
export class SalaryStructureService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
  ) {}

  /**
   * Creates a new salary structure row effective from `dto.effectiveFrom`.
   * If the employee already has a current row (`effectiveTo: null`), that
   * row's `effectiveTo` is closed to the day before the new row's
   * `effectiveFrom` — the old row itself is never otherwise touched.
   */
  async create(user: AuthUser, dto: CreateSalaryStructureDto) {
    const employee = await this.prisma.user.findFirst({
      where: { id: dto.userId, vendorId: user.vendorId },
      select: { id: true },
    });
    if (!employee) throw new NotFoundException('Employee not found.');

    const effectiveFrom = new Date(dto.effectiveFrom);

    return this.prisma.$transaction(async (tx) => {
      const previous = await tx.salaryStructure.findFirst({
        where: { vendorId: user.vendorId, userId: dto.userId, effectiveTo: null },
        orderBy: { effectiveFrom: 'desc' },
      });

      if (previous) {
        if (effectiveFrom <= previous.effectiveFrom) {
          throw new BadRequestException(
            `New effectiveFrom (${dto.effectiveFrom}) must be after the current structure's effectiveFrom (${previous.effectiveFrom
              .toISOString()
              .slice(0, 10)}).`,
          );
        }

        const effectiveTo = new Date(effectiveFrom);
        effectiveTo.setUTCDate(effectiveTo.getUTCDate() - 1);

        await tx.salaryStructure.update({
          where: { id: previous.id },
          data: { effectiveTo },
        });
      }

      const data: Prisma.SalaryStructureUncheckedCreateInput = {
        vendorId: user.vendorId,
        userId: dto.userId,
        baseAmount: dto.baseAmount,
        payFrequency: dto.payFrequency ?? PayFrequency.MONTHLY,
        effectiveFrom,
        createdById: user.userId,
      };
      if (dto.recurringLineItems) {
        data.recurringLineItems = dto.recurringLineItems as Prisma.InputJsonValue;
      }

      return tx.salaryStructure.create({ data });
    });
  }

  /**
   * Full versioned history for an employee, most recent first. Self-view-only
   * unless the requester holds `payroll:view_all`.
   */
  async listHistory(user: AuthUser, userId: string) {
    await assertCanViewEmployeePayroll(this.permissions, user, userId);
    await this.assertEmployeeInVendor(user.vendorId, userId);

    return this.prisma.salaryStructure.findMany({
      where: { vendorId: user.vendorId, userId },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  /**
   * The row effective on `onDate` (defaults to now), or null if none covers
   * that date. Self-view-only unless the requester holds `payroll:view_all`.
   */
  async getEffectiveOn(user: AuthUser, userId: string, onDate?: string) {
    await assertCanViewEmployeePayroll(this.permissions, user, userId);
    await this.assertEmployeeInVendor(user.vendorId, userId);

    const date = onDate ? new Date(onDate) : new Date();

    return this.prisma.salaryStructure.findFirst({
      where: {
        vendorId: user.vendorId,
        userId,
        effectiveFrom: { lte: date },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }],
      },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  private async assertEmployeeInVendor(vendorId: string, userId: string) {
    const employee = await this.prisma.user.findFirst({
      where: { id: userId, vendorId },
      select: { id: true },
    });
    if (!employee) throw new NotFoundException('Employee not found.');
  }
}
