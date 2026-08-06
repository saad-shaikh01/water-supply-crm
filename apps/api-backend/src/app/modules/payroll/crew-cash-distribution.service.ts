import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { CrewCashAuditAction, CrewCashCategory } from '@prisma/client';
import type { AuthUser } from '@water-supply-crm/types';
import { assertCanViewEmployeeCrewCash } from '../../common/helpers/crew-cash-view-scope.util';
import { PermissionService } from '../authz/permission.service';
import { PayrollApprovalGateService } from './payroll-approval-gate.service';
import { CreateCrewCashDistributionDto } from './dto/create-crew-cash-distribution.dto';
import { UpdateCrewCashDistributionDto } from './dto/update-crew-cash-distribution.dto';
import { ApproveCrewCashDistributionDto } from './dto/approve-crew-cash-distribution.dto';
import { RemoveCrewCashDistributionDto } from './dto/remove-crew-cash-distribution.dto';

function versionMismatch(expected: number, received: number): ConflictException {
  return new ConflictException(`Version mismatch: expected ${expected}, received ${received}. Reload and retry.`);
}

/** Window inside which a repeat (same sheet+employee+category+amount) is flagged, never blocked (doc §14). */
const DUPLICATE_WINDOW_MS = 5 * 60 * 1000;

/**
 * `PayrollApprovalRule.categoryKey` convention for this module — reuses the
 * existing gate/table (no schema change) keyed by a prefixed string so Crew
 * Cash thresholds never collide with StaffLedgerCategory keys.
 */
function approvalCategoryKey(category: CrewCashCategory): string {
  return `CREW_CASH_${category}`;
}

/**
 * Crew Cash Distribution — a Daily-Sheet-scoped, mutable-while-open record
 * of cash the recording Salesman/Driver/Staff hands out to crew members
 * (meals, tea, operational/emergency cash), extending Payroll per
 * docs/features/crew-operational-cash-distribution.md. Mirrors `Expense`'s
 * mutability (free edit/delete while the sheet is open) but additionally
 * keeps its own per-entity audit trail (§10) and a snapshot approval flag
 * (§6) the way `StaffLedgerEntry` does.
 *
 * Sync into the Payroll Ledger at `DailySheet.closeSheet()` (§6) is a
 * separate, later dispatch — this service only ever touches the CrewCash
 * side of the boundary; `syncedAt` is read-only here (checked, never set).
 */
@Injectable()
export class CrewCashDistributionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly approvalGate: PayrollApprovalGateService,
    private readonly permissions: PermissionService,
  ) {}

  /**
   * Creates a Crew Cash Distribution row. `employeeId` must be today's
   * confirmed crew for this sheet (the sheet's own `driverId`, or a
   * `DailySheetCrew` row) — a structural correctness guardrail (§4/§14), not
   * just a UI nicety. `date` is always the sheet's own date (§4: "not
   * editable"). `distributedById`/`createdById` are both the caller — the
   * person filling the form is, by definition, both the custodian who
   * recorded the entry (§2) and its creator for edit/delete purposes.
   */
  async create(user: AuthUser, dailySheetId: string, dto: CreateCrewCashDistributionDto) {
    const sheet = await this.prisma.dailySheet.findFirst({
      where: { id: dailySheetId, vendorId: user.vendorId },
      select: { id: true, date: true, isClosed: true, driverId: true },
    });
    if (!sheet) throw new NotFoundException('Daily sheet not found.');
    if (sheet.isClosed) {
      throw new BadRequestException('Cannot record a Crew Cash Distribution against a closed daily sheet.');
    }

    const isCrewMember = await this.isTodaysCrewMember(dailySheetId, sheet.driverId, dto.employeeId);
    if (!isCrewMember) {
      throw new BadRequestException(
        "The selected employee is not part of this daily sheet's confirmed crew (driver or DailySheetCrew).",
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // Approval-gate check and duplicate-detection both live inside the
      // transaction, alongside the write they inform — same placement
      // discipline as StaffLedgerService.create's own gate check.
      const [requiresApproval, duplicateCount] = await Promise.all([
        this.approvalGate.requiresApproval(user.vendorId, approvalCategoryKey(dto.category), dto.amount),
        tx.crewCashDistribution.count({
          where: {
            vendorId: user.vendorId,
            dailySheetId,
            employeeId: dto.employeeId,
            category: dto.category,
            amount: dto.amount,
            createdAt: { gte: new Date(Date.now() - DUPLICATE_WINDOW_MS) },
          },
        }),
      ]);

      const entry = await tx.crewCashDistribution.create({
        data: {
          vendorId: user.vendorId,
          dailySheetId,
          distributedById: user.userId,
          employeeId: dto.employeeId,
          category: dto.category,
          amount: dto.amount,
          notes: dto.notes ?? null,
          photoKeys: dto.photoKeys ?? [],
          date: sheet.date,
          requiresApproval,
          createdById: user.userId,
        },
      });

      await tx.crewCashDistributionAuditLog.create({
        data: {
          crewCashDistributionId: entry.id,
          actorId: user.userId,
          actorRole: user.role,
          action: CrewCashAuditAction.CREATED,
          afterJson: {
            employeeId: entry.employeeId,
            category: entry.category,
            amount: entry.amount,
            requiresApproval: entry.requiresApproval,
          },
        },
      });

      // Flag-not-block (§14): a legitimate second cup of tea is never
      // prevented — the caller just gets a heads-up in the response.
      return { ...entry, possibleDuplicate: duplicateCount > 0 };
    });
  }

  /**
   * Edits a pre-sync entry. Only `category`/`amount`/`notes`/`photoKeys` are
   * mutable — never the identity fields. Allowed for the entry's own creator
   * even without `crew_cash:edit`, OR for any `crew_cash:edit` holder —
   * creator-check first, permission-check as fallback, matching
   * `StaffLedgerService.voidEntry`'s exact "creator OR permission"
   * precedent. Re-evaluates the approval gate when category or amount
   * changed (a typo that crosses the threshold must re-flag); if the entry
   * was already approved, that approval is revoked on such a change too — it
   * certified the OLD values, not whatever the row now says, regardless of
   * which way the fresh gate evaluation lands.
   */
  async update(user: AuthUser, id: string, dto: UpdateCrewCashDistributionDto) {
    return this.prisma.$transaction(async (tx) => {
      const entry = await tx.crewCashDistribution.findFirst({ where: { id, vendorId: user.vendorId } });
      if (!entry) throw new NotFoundException('Crew Cash Distribution entry not found.');

      if (entry.syncedAt !== null) {
        throw new BadRequestException(
          'This entry has already synced into the Payroll Ledger and can no longer be edited directly.',
        );
      }

      if (entry.createdById !== user.userId) {
        const canEdit = await this.permissions.can(user.userId, 'crew_cash:edit');
        if (!canEdit) {
          throw new ForbiddenException('You may only edit a Crew Cash Distribution entry you created yourself.');
        }
      }

      const categoryChanged = dto.category !== undefined && dto.category !== entry.category;
      const amountChanged = dto.amount !== undefined && dto.amount !== entry.amount;

      let requiresApprovalUpdate: boolean | undefined;
      let clearApproval = false;
      if (categoryChanged || amountChanged) {
        const newCategory = dto.category ?? entry.category;
        const newAmount = dto.amount ?? entry.amount;
        requiresApprovalUpdate = await this.approvalGate.requiresApproval(
          user.vendorId,
          approvalCategoryKey(newCategory),
          newAmount,
        );
        if (entry.approvedAt !== null) clearApproval = true;
      }

      const claim = await tx.crewCashDistribution.updateMany({
        where: { id, vendorId: user.vendorId, version: dto.version },
        data: {
          ...(dto.category !== undefined && { category: dto.category }),
          ...(dto.amount !== undefined && { amount: dto.amount }),
          ...(dto.notes !== undefined && { notes: dto.notes }),
          ...(dto.photoKeys !== undefined && { photoKeys: dto.photoKeys }),
          ...(requiresApprovalUpdate !== undefined && { requiresApproval: requiresApprovalUpdate }),
          ...(clearApproval && { approvedAt: null, approvedById: null }),
          version: { increment: 1 },
        },
      });
      if (claim.count === 0) {
        throw versionMismatch(entry.version, dto.version);
      }

      const updated = await tx.crewCashDistribution.findUniqueOrThrow({ where: { id } });

      await tx.crewCashDistributionAuditLog.create({
        data: {
          crewCashDistributionId: id,
          actorId: user.userId,
          actorRole: user.role,
          action: CrewCashAuditAction.EDITED,
          beforeJson: {
            category: entry.category,
            amount: entry.amount,
            notes: entry.notes,
            photoKeys: entry.photoKeys,
            requiresApproval: entry.requiresApproval,
          },
          afterJson: {
            category: updated.category,
            amount: updated.amount,
            notes: updated.notes,
            photoKeys: updated.photoKeys,
            requiresApproval: updated.requiresApproval,
          },
        },
      });

      return updated;
    });
  }

  /**
   * Deletes a pre-sync entry — hard delete, matching `Expense`'s convention
   * (nothing downstream depends on a row that hasn't synced yet). Same
   * "creator OR permission" authorization as `update`.
   *
   * `CrewCashDistributionAuditLog.crewCashDistributionId` is nullable with
   * `ON DELETE SET NULL` (migration
   * `20260806205508_crew_cash_audit_log_nullable_fk`) — the DELETED audit row
   * is written to this entity's own audit table exactly like CREATED/
   * EDITED/APPROVED, in the same transaction, before the row is gone. When
   * the hard delete then runs, the database itself sets
   * `crewCashDistributionId` to `null` on every audit row that referenced
   * this entity (including the DELETED row just written and every prior
   * CREATED/EDITED/APPROVED row) — the data survives, only the FK link is
   * cleared, so no manual cleanup or diversion to a different audit table is
   * needed.
   */
  async remove(user: AuthUser, id: string, dto?: RemoveCrewCashDistributionDto) {
    return this.prisma.$transaction(async (tx) => {
      const entry = await tx.crewCashDistribution.findFirst({ where: { id, vendorId: user.vendorId } });
      if (!entry) throw new NotFoundException('Crew Cash Distribution entry not found.');

      if (entry.syncedAt !== null) {
        throw new BadRequestException(
          'This entry has already synced into the Payroll Ledger and can no longer be deleted directly.',
        );
      }

      if (entry.createdById !== user.userId) {
        const canDelete = await this.permissions.can(user.userId, 'crew_cash:delete');
        if (!canDelete) {
          throw new ForbiddenException('You may only delete a Crew Cash Distribution entry you created yourself.');
        }
      }

      // Audit row is written FIRST, referencing the still-live id — the FK
      // requires the parent to exist at insert time. If the guarded delete
      // below finds the row already synced and throws, this whole $transaction
      // rolls back (including this insert), so no orphaned/incorrect DELETED
      // row is ever left behind for a delete that didn't actually happen.
      await tx.crewCashDistributionAuditLog.create({
        data: {
          crewCashDistributionId: id,
          actorId: user.userId,
          actorRole: user.role,
          action: CrewCashAuditAction.DELETED,
          reason: dto?.reason ?? null,
          beforeJson: {
            dailySheetId: entry.dailySheetId,
            distributedById: entry.distributedById,
            employeeId: entry.employeeId,
            category: entry.category,
            amount: entry.amount,
            notes: entry.notes,
            photoKeys: entry.photoKeys,
            requiresApproval: entry.requiresApproval,
            approvedById: entry.approvedById,
            approvedAt: entry.approvedAt,
          },
        },
      });

      // Atomic compare-and-delete: the earlier findFirst() above is a read,
      // not a lock — a concurrent sheet-close sync could set syncedAt between
      // that read and this delete. Scoping the delete itself to syncedAt: null
      // closes that race instead of trusting the earlier read to still be true.
      const result = await tx.crewCashDistribution.deleteMany({
        where: { id, vendorId: user.vendorId, syncedAt: null },
      });
      if (result.count === 0) {
        throw new BadRequestException(
          'This entry has already synced into the Payroll Ledger and can no longer be deleted directly.',
        );
      }

      return { deleted: true };
    });
  }

  /**
   * Approves a PENDING (requiresApproval && unapproved) entry. Atomic CAS
   * like every other mutation here.
   */
  async approve(user: AuthUser, id: string, dto: ApproveCrewCashDistributionDto) {
    return this.prisma.$transaction(async (tx) => {
      const entry = await tx.crewCashDistribution.findFirst({ where: { id, vendorId: user.vendorId } });
      if (!entry) throw new NotFoundException('Crew Cash Distribution entry not found.');

      if (!entry.requiresApproval || entry.approvedAt !== null) {
        throw new BadRequestException('Only entries that require approval and are not yet approved can be approved.');
      }

      const claim = await tx.crewCashDistribution.updateMany({
        where: { id, vendorId: user.vendorId, version: dto.version },
        data: { approvedById: user.userId, approvedAt: new Date(), version: { increment: 1 } },
      });
      if (claim.count === 0) {
        throw versionMismatch(entry.version, dto.version);
      }

      const updated = await tx.crewCashDistribution.findUniqueOrThrow({ where: { id } });

      await tx.crewCashDistributionAuditLog.create({
        data: {
          crewCashDistributionId: id,
          actorId: user.userId,
          actorRole: user.role,
          action: CrewCashAuditAction.APPROVED,
          beforeJson: { approvedAt: null, approvedById: null },
          afterJson: { approvedById: updated.approvedById, approvedAt: updated.approvedAt },
        },
      });

      return updated;
    });
  }

  /** All Crew Cash Distribution rows for one sheet — tenancy-scoped, no dedicated permission (see rbac-permission-catalog.md §28). */
  async listForSheet(user: AuthUser, dailySheetId: string) {
    const sheet = await this.prisma.dailySheet.findFirst({
      where: { id: dailySheetId, vendorId: user.vendorId },
      select: { id: true },
    });
    if (!sheet) throw new NotFoundException('Daily sheet not found.');

    return this.prisma.crewCashDistribution.findMany({
      where: { vendorId: user.vendorId, dailySheetId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** An employee's full Crew Cash Distribution history — self-view-only unless `crew_cash:view_all`. */
  async listForEmployee(user: AuthUser, employeeId: string) {
    await assertCanViewEmployeeCrewCash(this.permissions, user, employeeId);

    const employee = await this.prisma.user.findFirst({
      where: { id: employeeId, vendorId: user.vendorId },
      select: { id: true },
    });
    if (!employee) throw new NotFoundException('Employee not found.');

    return this.prisma.crewCashDistribution.findMany({
      where: { vendorId: user.vendorId, employeeId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** True when `employeeId` is the sheet's driver, or holds a `DailySheetCrew` row for this sheet (§4/§14 guardrail). */
  private async isTodaysCrewMember(dailySheetId: string, driverId: string, employeeId: string): Promise<boolean> {
    if (employeeId === driverId) return true;

    const crewRow = await this.prisma.dailySheetCrew.findUnique({
      where: { dailySheetId_userId: { dailySheetId, userId: employeeId } },
      select: { id: true },
    });
    return crewRow !== null;
  }
}
