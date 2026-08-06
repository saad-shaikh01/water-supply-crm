import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { PayrollAuditAction, PayrollEntryStatus } from '@prisma/client';
import type { AuthUser } from '@water-supply-crm/types';
import { assertCanViewEmployeePayroll } from '../../common/helpers/payroll-view-scope.util';
import { PermissionService } from '../authz/permission.service';
import { RecordSettlementDto } from './dto/record-settlement.dto';

function versionMismatch(expected: number, received: number): ConflictException {
  return new ConflictException(`Version mismatch: expected ${expected}, received ${received}. Reload and retry.`);
}

/**
 * Settlement — the actual-money-changing-hands event against a locked
 * `PayrollEntry` (§4/§7/§9 of the planning doc). A Payroll Entry can be
 * LOCKED-but-unpaid (approved, awaiting cash); Settlement is the separate
 * record of disbursement, and supports partial payment across several rows.
 */
@Injectable()
export class SettlementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
  ) {}

  /**
   * Records one payment against a LOCKED (or already SETTLED, for a later
   * installment) entry. No validation that the amount doesn't exceed the
   * remaining balance — over/under-payment both flow into the next period's
   * carry-forward (§5), not something this endpoint blocks.
   *
   * If the entry is still LOCKED and `finalPayable > 0`, checks whether the
   * cumulative sum of settlements against it has now reached or exceeded
   * `finalPayable` and, if so, auto-transitions the entry to SETTLED in the
   * same transaction (atomic CAS against the version already read in this
   * transaction, guarding the rare interleaving where another transaction
   * mutates the entry between this read and this write). `finalPayable <= 0`
   * is deliberately never auto-settled here — there's nothing to collect, so
   * closing it out is `markSettled`'s explicit job, not an accidental
   * side-effect of an unrelated settlement row.
   */
  async record(user: AuthUser, payrollEntryId: string, dto: RecordSettlementDto) {
    return this.prisma.$transaction(async (tx) => {
      const entry = await tx.payrollEntry.findFirst({ where: { id: payrollEntryId, vendorId: user.vendorId } });
      if (!entry) throw new NotFoundException('Payroll entry not found.');

      if (entry.status !== PayrollEntryStatus.LOCKED && entry.status !== PayrollEntryStatus.SETTLED) {
        throw new BadRequestException(
          `Settlements can only be recorded against a LOCKED or SETTLED entry (current status: ${entry.status}).`,
        );
      }

      const settlement = await tx.settlement.create({
        data: {
          payrollEntryId: entry.id,
          vendorId: user.vendorId,
          amount: dto.amount,
          method: dto.method,
          referenceNote: dto.referenceNote ?? null,
          paidById: user.userId,
          paidAt: new Date(),
        },
      });

      let updatedEntry = entry;
      let autoSettled = false;

      if (entry.status === PayrollEntryStatus.LOCKED && entry.finalPayable > 0) {
        const totalSettled = await tx.settlement.aggregate({
          where: { payrollEntryId: entry.id },
          _sum: { amount: true },
        });
        const cumulative = totalSettled._sum.amount ?? 0;

        if (cumulative >= entry.finalPayable) {
          const claim = await tx.payrollEntry.updateMany({
            where: { id: entry.id, vendorId: user.vendorId, version: entry.version },
            data: { status: PayrollEntryStatus.SETTLED, version: { increment: 1 } },
          });
          if (claim.count === 0) {
            throw new ConflictException(
              'Payroll entry was modified concurrently while recording this settlement. Reload and retry.',
            );
          }
          updatedEntry = await tx.payrollEntry.findUniqueOrThrow({ where: { id: entry.id } });
          autoSettled = true;
        }
      }

      await tx.payrollEntryAuditLog.create({
        data: {
          payrollEntryId: entry.id,
          actorId: user.userId,
          actorRole: user.role,
          action: PayrollAuditAction.SETTLED,
          beforeJson: { status: entry.status },
          afterJson: {
            settlementId: settlement.id,
            amount: settlement.amount,
            method: settlement.method,
            status: updatedEntry.status,
          },
        },
      });

      return { settlement, entry: updatedEntry, autoSettled };
    });
  }

  /**
   * Explicitly closes out a LOCKED entry as SETTLED without requiring the
   * sum of its settlements to reach `finalPayable` — covers `finalPayable <=
   * 0` (nothing to collect, no settlement rows required at all) and the
   * "close enough, no more money owed, let the rest carry forward" case
   * (§5: "the manager decides whether to let it carry forward").
   */
  async markSettled(user: AuthUser, payrollEntryId: string, version: number) {
    return this.prisma.$transaction(async (tx) => {
      const entry = await tx.payrollEntry.findFirst({ where: { id: payrollEntryId, vendorId: user.vendorId } });
      if (!entry) throw new NotFoundException('Payroll entry not found.');

      if (entry.status !== PayrollEntryStatus.LOCKED) {
        throw new BadRequestException(`Only LOCKED entries can be marked settled (current status: ${entry.status}).`);
      }

      const claim = await tx.payrollEntry.updateMany({
        where: { id: entry.id, vendorId: user.vendorId, version },
        data: { status: PayrollEntryStatus.SETTLED, version: { increment: 1 } },
      });
      if (claim.count === 0) {
        throw versionMismatch(entry.version, version);
      }

      const updated = await tx.payrollEntry.findUniqueOrThrow({ where: { id: entry.id } });

      await tx.payrollEntryAuditLog.create({
        data: {
          payrollEntryId: entry.id,
          actorId: user.userId,
          actorRole: user.role,
          action: PayrollAuditAction.SETTLED,
          beforeJson: { status: entry.status, finalPayable: entry.finalPayable },
          afterJson: { status: updated.status },
        },
      });

      return updated;
    });
  }

  /**
   * All settlements for one entry, plus a live `remainingBalance` (may be
   * negative if overpaid) — the "shows remaining balance live" UX (§7).
   * Self-view-only unless the requester holds `payroll:view_all`, same
   * scoping as `PayrollEntryService.getBreakdown`.
   */
  async listForEntry(user: AuthUser, payrollEntryId: string) {
    const entry = await this.prisma.payrollEntry.findFirst({
      where: { id: payrollEntryId, vendorId: user.vendorId },
    });
    if (!entry) throw new NotFoundException('Payroll entry not found.');

    await assertCanViewEmployeePayroll(this.permissions, user, entry.userId);

    const settlements = await this.prisma.settlement.findMany({
      where: { payrollEntryId: entry.id, vendorId: user.vendorId },
      orderBy: { paidAt: 'asc' },
    });

    const totalSettled = settlements.reduce((sum, settlement) => sum + settlement.amount, 0);
    const remainingBalance = entry.finalPayable - totalSettled;

    return { settlements, remainingBalance };
  }
}
