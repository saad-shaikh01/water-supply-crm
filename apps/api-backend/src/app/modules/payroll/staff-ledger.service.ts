import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { LedgerEntryStatus, Prisma, StaffLedgerAuditAction, StaffLedgerCategory } from '@prisma/client';
import type { AuthUser } from '@water-supply-crm/types';
import { paginate } from '../../common/helpers/paginate';
import { assertCanViewEmployeePayroll } from '../../common/helpers/payroll-view-scope.util';
import { PermissionService } from '../authz/permission.service';
import { PayrollApprovalGateService } from './payroll-approval-gate.service';
import { CreateStaffLedgerEntryDto } from './dto/create-staff-ledger-entry.dto';
import { ApproveStaffLedgerEntryDto } from './dto/approve-staff-ledger-entry.dto';
import { VoidStaffLedgerEntryDto } from './dto/void-staff-ledger-entry.dto';
import { ReverseStaffLedgerEntryDto } from './dto/reverse-staff-ledger-entry.dto';
import { CorrectStaffLedgerEntryDto } from './dto/correct-staff-ledger-entry.dto';
import { LedgerEntryQueryDto } from './dto/ledger-entry-query.dto';

function versionMismatch(expected: number, received: number): ConflictException {
  return new ConflictException(`Version mismatch: expected ${expected}, received ${received}. Reload and retry.`);
}

/**
 * Append-only staff ledger (§ schema module note, StaffLedgerEntry) — every
 * non-salary financial event against an employee. Entries are never deleted
 * or mutated in place beyond status/approval fields; corrections/reversals
 * are always new rows linked back via `reversedEntryId`.
 */
@Injectable()
export class StaffLedgerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly approvalGate: PayrollApprovalGateService,
    private readonly permissions: PermissionService,
  ) {}

  /**
   * Creates a new ledger entry. Status is PENDING if the (vendorId,
   * category) approval rule trips for this amount, otherwise POSTED
   * immediately.
   */
  async create(user: AuthUser, dto: CreateStaffLedgerEntryDto) {
    const employee = await this.prisma.user.findFirst({
      where: { id: dto.userId, vendorId: user.vendorId },
      select: { id: true },
    });
    if (!employee) throw new NotFoundException('Employee not found.');

    return this.prisma.$transaction((tx) => this.createTx(tx, user, dto));
  }

  /**
   * Core of `create`, composable into an externally-managed transaction —
   * same tx-parameterized pattern `CrewCashDistributionService.syncOneRow`
   * already uses for `syncSheetToLedger`. Used by `create` itself, and by
   * `CrewCashDistributionService.correctSyncedEntry` (Phase 3-4), which needs
   * a fresh replacement entry created atomically alongside a void/reverse of
   * the original — two separate top-level `$transaction` calls would each
   * commit independently, leaving a real partial-application window. Caller
   * is responsible for any employee-existence/tenancy check (`create` does
   * its own above, outside the transaction; `correctSyncedEntry` does its
   * own inside its transaction before calling this).
   */
  async createTx(tx: Prisma.TransactionClient, user: AuthUser, dto: CreateStaffLedgerEntryDto) {
    // Gate check lives inside the transaction, alongside every other
    // create/reverse/correct approval-gate check — kept consistent so the
    // decision is always made in the same place relative to the write.
    const requiresApproval = await this.approvalGate.requiresApproval(user.vendorId, dto.category, dto.amount);
    const status = requiresApproval ? LedgerEntryStatus.PENDING : LedgerEntryStatus.POSTED;

    const entry = await tx.staffLedgerEntry.create({
      data: {
        vendorId: user.vendorId,
        userId: dto.userId,
        category: dto.category,
        amount: dto.amount,
        effectiveDate: new Date(dto.effectiveDate),
        description: dto.description ?? null,
        status,
        createdById: user.userId,
      },
    });

    await tx.staffLedgerAuditLog.create({
      data: {
        ledgerEntryId: entry.id,
        actorId: user.userId,
        actorRole: user.role,
        action: StaffLedgerAuditAction.CREATED,
        afterJson: { category: entry.category, amount: entry.amount, status: entry.status },
      },
    });

    return entry;
  }

  /** Approves a PENDING entry — POSTED, approvedById/approvedAt recorded. */
  async approve(user: AuthUser, id: string, dto: ApproveStaffLedgerEntryDto) {
    return this.prisma.$transaction(async (tx) => {
      const entry = await tx.staffLedgerEntry.findFirst({ where: { id, vendorId: user.vendorId } });
      if (!entry) throw new NotFoundException('Ledger entry not found.');

      if (entry.status !== LedgerEntryStatus.PENDING) {
        throw new BadRequestException('Only PENDING entries can be approved.');
      }

      // Atomic compare-and-swap: the WHERE clause itself enforces the version
      // match at the database level, so two concurrent approvals can never
      // both succeed (READ COMMITTED would otherwise let both pass the
      // in-app check above and silently overwrite each other).
      const claim = await tx.staffLedgerEntry.updateMany({
        where: { id, vendorId: user.vendorId, version: dto.version },
        data: {
          status: LedgerEntryStatus.POSTED,
          approvedById: user.userId,
          approvedAt: new Date(),
          version: { increment: 1 },
        },
      });
      if (claim.count === 0) {
        throw versionMismatch(entry.version, dto.version);
      }

      const updated = await tx.staffLedgerEntry.findUniqueOrThrow({ where: { id } });

      await tx.staffLedgerAuditLog.create({
        data: {
          ledgerEntryId: id,
          actorId: user.userId,
          actorRole: user.role,
          action: StaffLedgerAuditAction.APPROVED,
          beforeJson: { status: entry.status },
          afterJson: { status: updated.status, approvedById: user.userId },
        },
      });

      return updated;
    });
  }

  /**
   * Voids a PENDING entry, or a POSTED entry not yet rolled into a locked
   * payroll period. Entries already rolled in must go through
   * `reverse`/`correct` instead — voiding history that payroll has already
   * consumed would silently desync the frozen numbers.
   *
   * Authorization (§10: "creator or VENDOR_ADMIN"): allowed if the requester
   * holds `payroll:ledger_void` (VENDOR_ADMIN by preset) OR is the entry's
   * own `createdById` — the creator exception is an ADDITIONAL code path
   * alongside the permission check, not a replacement for it, so a
   * permission holder can always void any entry regardless of who created
   * it. Checked here (not as a route decorator) because "am I the creator"
   * can only be answered after the entry is fetched.
   */
  async voidEntry(user: AuthUser, id: string, dto: VoidStaffLedgerEntryDto) {
    return this.prisma.$transaction((tx) => this.voidEntryTx(tx, user, id, dto));
  }

  /**
   * Core of `voidEntry`, composable into an externally-managed transaction —
   * see `createTx`'s doc comment for why this exists. Used by `voidEntry`
   * itself, and by `CrewCashDistributionService.correctSyncedEntry` for the
   * not-yet-locked branch (void the original, then `createTx` a fresh
   * replacement, atomically).
   */
  async voidEntryTx(tx: Prisma.TransactionClient, user: AuthUser, id: string, dto: VoidStaffLedgerEntryDto) {
    const entry = await tx.staffLedgerEntry.findFirst({ where: { id, vendorId: user.vendorId } });
    if (!entry) throw new NotFoundException('Ledger entry not found.');

    if (entry.createdById !== user.userId) {
      const canVoid = await this.permissions.can(user.userId, 'payroll:ledger_void');
      if (!canVoid) {
        throw new ForbiddenException('You may only void a ledger entry you created yourself.');
      }
    }

    const voidable =
      entry.status === LedgerEntryStatus.PENDING ||
      (entry.status === LedgerEntryStatus.POSTED && entry.payrollEntryId === null);
    if (!voidable) {
      throw new BadRequestException(
        'Only PENDING entries or POSTED entries not yet rolled into a locked payroll period can be voided. Use reverse or correct for entries already rolled into payroll.',
      );
    }

    // Atomic compare-and-swap — see approve() for why this can't be a
    // stale-read-then-update.
    const claim = await tx.staffLedgerEntry.updateMany({
      where: { id, vendorId: user.vendorId, version: dto.version },
      data: { status: LedgerEntryStatus.VOIDED, version: { increment: 1 } },
    });
    if (claim.count === 0) {
      throw versionMismatch(entry.version, dto.version);
    }

    const updated = await tx.staffLedgerEntry.findUniqueOrThrow({ where: { id } });

    await tx.staffLedgerAuditLog.create({
      data: {
        ledgerEntryId: id,
        actorId: user.userId,
        actorRole: user.role,
        action: StaffLedgerAuditAction.VOIDED,
        reason: dto.reason,
        beforeJson: { status: entry.status },
        afterJson: { status: updated.status },
      },
    });

    return updated;
  }

  /**
   * Reverses a POSTED entry already rolled into a locked payroll period.
   * The original row is immutable history at that point — instead this
   * creates a NEW entry with the opposite sign (category=REVERSAL,
   * `reversedEntryId` pointing at the original) attributed to today, so it
   * flows into the currently open payroll period rather than retroactively
   * editing a locked one. The new entry passes through the same approval
   * gate as any other create.
   */
  async reverse(user: AuthUser, id: string, dto: ReverseStaffLedgerEntryDto) {
    return this.prisma.$transaction((tx) => this.reverseTx(tx, user, id, dto));
  }

  /**
   * Core of `reverse`, composable into an externally-managed transaction —
   * see `createTx`'s doc comment for why this exists. Used by `reverse`
   * itself, and by `CrewCashDistributionService.correctSyncedEntry` for the
   * locked + wrong-employee branch (reverse the entry against the wrong
   * employee, then `createTx` a fresh entry for the right one, atomically).
   */
  async reverseTx(tx: Prisma.TransactionClient, user: AuthUser, id: string, dto: ReverseStaffLedgerEntryDto) {
    const original = await tx.staffLedgerEntry.findFirst({ where: { id, vendorId: user.vendorId } });
    if (!original) throw new NotFoundException('Ledger entry not found.');

    if (original.status !== LedgerEntryStatus.POSTED || original.payrollEntryId === null) {
      throw new BadRequestException(
        'Only POSTED entries already rolled into a locked payroll period can be reversed. Use void for entries not yet locked.',
      );
    }

    // Atomic compare-and-swap, claimed BEFORE creating the reversal row so
    // a stale/concurrent request fails fast without leaving an orphan
    // reversal entry behind. See approve() for why this can't be a
    // stale-read-then-update.
    const claim = await tx.staffLedgerEntry.updateMany({
      where: { id: original.id, vendorId: user.vendorId, version: dto.version },
      data: { version: { increment: 1 } },
    });
    if (claim.count === 0) {
      throw versionMismatch(original.version, dto.version);
    }

    const reversalAmount = -original.amount;
    const reversalRequiresApproval = await this.approvalGate.requiresApproval(
      user.vendorId,
      StaffLedgerCategory.REVERSAL,
      reversalAmount,
    );

    const reversalEntry = await tx.staffLedgerEntry.create({
      data: {
        vendorId: user.vendorId,
        userId: original.userId,
        category: StaffLedgerCategory.REVERSAL,
        amount: reversalAmount,
        effectiveDate: new Date(),
        description: dto.reason,
        status: reversalRequiresApproval ? LedgerEntryStatus.PENDING : LedgerEntryStatus.POSTED,
        createdById: user.userId,
        reversedEntryId: original.id,
      },
    });

    const updatedOriginal = await tx.staffLedgerEntry.findUniqueOrThrow({ where: { id: original.id } });

    await tx.staffLedgerAuditLog.create({
      data: {
        ledgerEntryId: original.id,
        actorId: user.userId,
        actorRole: user.role,
        action: StaffLedgerAuditAction.REVERSED,
        reason: dto.reason,
        beforeJson: { status: original.status, amount: original.amount },
        afterJson: { reversalEntryId: reversalEntry.id },
      },
    });

    await tx.staffLedgerAuditLog.create({
      data: {
        ledgerEntryId: reversalEntry.id,
        actorId: user.userId,
        actorRole: user.role,
        action: StaffLedgerAuditAction.REVERSED,
        reason: dto.reason,
        afterJson: { amount: reversalEntry.amount, status: reversalEntry.status, reversedEntryId: original.id },
      },
    });

    return { original: updatedOriginal, reversal: reversalEntry };
  }

  /**
   * Corrects a POSTED entry already rolled into a locked payroll period:
   * reverses the wrong one (category=REVERSAL) and creates a fresh entry
   * with the intended correct amount (category=CORRECTION), both linked
   * back to the original via `reversedEntryId` so the full chain for the
   * original entry is queryable. Both new rows are attributed to today, for
   * the same reason `reverse` is.
   */
  async correct(user: AuthUser, id: string, dto: CorrectStaffLedgerEntryDto) {
    return this.prisma.$transaction((tx) => this.correctTx(tx, user, id, dto));
  }

  /**
   * Core of `correct`, composable into an externally-managed transaction —
   * see `createTx`'s doc comment for why this exists. Used by `correct`
   * itself, and by `CrewCashDistributionService.correctSyncedEntry` for the
   * locked + same-employee branch, which can hand this the corrected amount
   * as-is (`correct` cannot reassign `userId` — it hardcodes
   * `original.userId` on the fresh correction row below, by design).
   */
  async correctTx(tx: Prisma.TransactionClient, user: AuthUser, id: string, dto: CorrectStaffLedgerEntryDto) {
    const original = await tx.staffLedgerEntry.findFirst({ where: { id, vendorId: user.vendorId } });
    if (!original) throw new NotFoundException('Ledger entry not found.');

    if (original.status !== LedgerEntryStatus.POSTED || original.payrollEntryId === null) {
      throw new BadRequestException(
        'Only POSTED entries already rolled into a locked payroll period can be corrected. Use void for entries not yet locked.',
      );
    }

    // Atomic compare-and-swap, claimed BEFORE creating the reversal/
    // correction rows so a stale/concurrent request fails fast without
    // leaving orphan entries behind. See approve() for why this can't be a
    // stale-read-then-update.
    const claim = await tx.staffLedgerEntry.updateMany({
      where: { id: original.id, vendorId: user.vendorId, version: dto.version },
      data: { version: { increment: 1 } },
    });
    if (claim.count === 0) {
      throw versionMismatch(original.version, dto.version);
    }

    const reversalAmount = -original.amount;
    const [reversalRequiresApproval, correctionRequiresApproval] = await Promise.all([
      this.approvalGate.requiresApproval(user.vendorId, StaffLedgerCategory.REVERSAL, reversalAmount),
      this.approvalGate.requiresApproval(user.vendorId, StaffLedgerCategory.CORRECTION, dto.correctedAmount),
    ]);

    const now = new Date();

    const reversalEntry = await tx.staffLedgerEntry.create({
      data: {
        vendorId: user.vendorId,
        userId: original.userId,
        category: StaffLedgerCategory.REVERSAL,
        amount: reversalAmount,
        effectiveDate: now,
        description: dto.reason,
        status: reversalRequiresApproval ? LedgerEntryStatus.PENDING : LedgerEntryStatus.POSTED,
        createdById: user.userId,
        reversedEntryId: original.id,
      },
    });

    const correctionEntry = await tx.staffLedgerEntry.create({
      data: {
        vendorId: user.vendorId,
        userId: original.userId,
        category: StaffLedgerCategory.CORRECTION,
        amount: dto.correctedAmount,
        effectiveDate: now,
        description: dto.reason,
        status: correctionRequiresApproval ? LedgerEntryStatus.PENDING : LedgerEntryStatus.POSTED,
        createdById: user.userId,
        reversedEntryId: original.id,
      },
    });

    const updatedOriginal = await tx.staffLedgerEntry.findUniqueOrThrow({ where: { id: original.id } });

    await tx.staffLedgerAuditLog.create({
      data: {
        ledgerEntryId: original.id,
        actorId: user.userId,
        actorRole: user.role,
        action: StaffLedgerAuditAction.CORRECTED,
        reason: dto.reason,
        beforeJson: { status: original.status, amount: original.amount },
        afterJson: { reversalEntryId: reversalEntry.id, correctionEntryId: correctionEntry.id },
      },
    });

    await tx.staffLedgerAuditLog.create({
      data: {
        ledgerEntryId: reversalEntry.id,
        actorId: user.userId,
        actorRole: user.role,
        action: StaffLedgerAuditAction.CORRECTED,
        reason: dto.reason,
        afterJson: { amount: reversalEntry.amount, status: reversalEntry.status },
      },
    });

    await tx.staffLedgerAuditLog.create({
      data: {
        ledgerEntryId: correctionEntry.id,
        actorId: user.userId,
        actorRole: user.role,
        action: StaffLedgerAuditAction.CORRECTED,
        reason: dto.reason,
        afterJson: { amount: correctionEntry.amount, status: correctionEntry.status },
      },
    });

    return { original: updatedOriginal, reversal: reversalEntry, correction: correctionEntry };
  }

  /**
   * Financial timeline for an employee — filterable by date range/category/
   * status. Self-view-only unless the requester holds `payroll:view_all`
   * (see `assertCanViewEmployeePayroll`).
   */
  async findForEmployee(user: AuthUser, userId: string, query: LedgerEntryQueryDto) {
    await assertCanViewEmployeePayroll(this.permissions, user, userId);

    const employee = await this.prisma.user.findFirst({
      where: { id: userId, vendorId: user.vendorId },
      select: { id: true },
    });
    if (!employee) throw new NotFoundException('Employee not found.');

    const { page = 1, limit = 20, category, status, dateFrom, dateTo } = query;

    const where: Prisma.StaffLedgerEntryWhereInput = { vendorId: user.vendorId, userId };
    if (category) where.category = category;
    if (status) where.status = status;
    if (dateFrom || dateTo) {
      where.effectiveDate = {
        ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
        ...(dateTo ? { lte: new Date(dateTo) } : {}),
      };
    }

    const [data, total] = await Promise.all([
      this.prisma.staffLedgerEntry.findMany({
        where,
        orderBy: { effectiveDate: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.staffLedgerEntry.count({ where }),
    ]);

    return paginate(data, total, page, limit);
  }
}
