import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import type { AuthUser } from '@water-supply-crm/types';
import { CreateSalaryStructureDto } from './dto/create-salary-structure.dto';
import { VoidSalaryStructureDto } from './dto/void-salary-structure.dto';
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
        where: { vendorId: user.vendorId, userId: dto.userId, effectiveTo: null, voidedAt: null },
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
        voidedAt: null,
        effectiveFrom: { lte: date },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }],
      },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  /**
   * Void (owner-requested 2026-09-25) — fixes a wrong amount/date data-entry
   * mistake without ever editing a row in place. Only the current/latest,
   * non-voided row for this employee may be voided; if it had trimmed a
   * predecessor when it was created, that predecessor is reopened
   * (`effectiveTo` reset to null) — identified as the non-voided row with the
   * next-lower `effectiveFrom` for the same employee, which by the
   * maintained contiguous-range invariant is guaranteed to be the trimmed
   * one, if any. Mirrors `ProductCostService.voidCurrentRow` exactly.
   */
  async voidCurrentRow(user: AuthUser, id: string, dto: VoidSalaryStructureDto) {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.salaryStructure.findFirst({
        where: { id, vendorId: user.vendorId, voidedAt: null },
      });
      if (!row) throw new NotFoundException('Salary structure row not found.');

      if (row.effectiveTo !== null) {
        throw new BadRequestException(
          'Only the current (latest, open-ended) salary structure row may be voided. Historical rows are permanent once superseded.',
        );
      }

      // Belt-and-suspenders: confirm no other non-voided row for this
      // employee has a later effectiveFrom (the invariant guarantees this
      // can't happen once effectiveTo === null, but verify rather than
      // assume).
      const laterRow = await tx.salaryStructure.findFirst({
        where: {
          vendorId: user.vendorId,
          userId: row.userId,
          voidedAt: null,
          effectiveFrom: { gt: row.effectiveFrom },
        },
      });
      if (laterRow) {
        throw new BadRequestException('Only the current (latest) salary structure row may be voided.');
      }

      const predecessor = await tx.salaryStructure.findFirst({
        where: {
          vendorId: user.vendorId,
          userId: row.userId,
          voidedAt: null,
          effectiveFrom: { lt: row.effectiveFrom },
        },
        orderBy: { effectiveFrom: 'desc' },
      });

      if (predecessor) {
        await tx.salaryStructure.update({
          where: { id: predecessor.id },
          data: { effectiveTo: null },
        });
      }

      const voided = await tx.salaryStructure.update({
        where: { id: row.id },
        data: {
          voidedAt: new Date(),
          voidedById: user.userId,
          voidReason: dto.voidReason,
        },
      });

      await tx.auditLog.create({
        data: {
          vendorId: user.vendorId,
          userId: user.userId,
          userName: user.name,
          entity: 'SalaryStructure',
          entityId: row.id,
          action: 'VOID',
          changes: {
            before: { voidedAt: null, effectiveTo: row.effectiveTo, baseAmount: row.baseAmount, effectiveFrom: row.effectiveFrom },
            after: {
              voidedAt: voided.voidedAt,
              voidReason: dto.voidReason,
              reopenedPredecessorId: predecessor?.id ?? null,
            },
          } as Prisma.InputJsonValue,
        },
      });

      return voided;
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
