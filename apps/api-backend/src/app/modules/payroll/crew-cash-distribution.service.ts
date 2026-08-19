import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '@water-supply-crm/database';
import { QUEUE_NAMES, JOB_NAMES } from '@water-supply-crm/queue';
import {
  CrewCashAuditAction,
  CrewCashCategory,
  CrewCashDistribution,
  LedgerEntryStatus,
  Prisma,
  StaffLedgerCategory,
  UserRole,
} from '@prisma/client';
import type { AuthUser } from '@water-supply-crm/types';
import { assertCanViewEmployeeCrewCash } from '../../common/helpers/crew-cash-view-scope.util';
import { PermissionService } from '../authz/permission.service';
import { PayrollApprovalGateService } from './payroll-approval-gate.service';
import { StaffLedgerService } from './staff-ledger.service';
import { CreateCrewCashDistributionDto } from './dto/create-crew-cash-distribution.dto';
import { UpdateCrewCashDistributionDto } from './dto/update-crew-cash-distribution.dto';
import { ApproveCrewCashDistributionDto } from './dto/approve-crew-cash-distribution.dto';
import { RemoveCrewCashDistributionDto } from './dto/remove-crew-cash-distribution.dto';
import { CorrectCrewCashDistributionDto } from './dto/correct-crew-cash-distribution.dto';

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
 * Sync into the Payroll Ledger (§6) happens three ways: in bulk via
 * `syncSheetToLedger`, composed into `DailySheetService.closeSheet()`'s own
 * transaction so a sheet can never end up closed with its Crew Cash rows
 * only partially synced; per-row inside `approve()`, for the case where an
 * entry is approved AFTER its sheet already closed (the bulk sweep at close
 * time skips anything still pending approval, so that one row would
 * otherwise be stranded unsynced until some other event happened to it); and
 * via the nightly `syncStaleSheets()` sweep, which unblocks Payroll for a
 * sheet that is stuck open (e.g. driver never resolves every PENDING
 * delivery item) without waiting for — or forcing — an actual close. A sheet
 * closing is a reconciliation-completeness statement (bottles/cash/empties
 * balance); Payroll getting paid on time is a separate concern and must not
 * be held hostage by the former. `syncStaleSheets()` never touches
 * `isClosed` — the sheet stays open and visibly incomplete on the daily
 * sheet list; only its already-approved/no-approval-needed Crew Cash rows
 * get moved into the ledger once their calendar day has fully passed.
 */
@Injectable()
export class CrewCashDistributionService implements OnModuleInit {
  private readonly logger = new Logger(CrewCashDistributionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly approvalGate: PayrollApprovalGateService,
    private readonly permissions: PermissionService,
    private readonly staffLedger: StaffLedgerService,
    @InjectQueue(QUEUE_NAMES.CREW_CASH_SYNC)
    private readonly crewCashSyncQueue: Queue,
  ) {}

  private static readonly STALE_SYNC_CRON = '30 0 * * *'; // 00:30 AM, after daily-sheet auto-gen (00:05) + fleet sweep (00:15)
  private static readonly STALE_SYNC_TZ = 'Asia/Karachi';
  private static readonly STALE_SYNC_JOB_ID = 'crew-cash-stale-sync';

  async onModuleInit() {
    try {
      await this.crewCashSyncQueue.upsertJobScheduler(
        CrewCashDistributionService.STALE_SYNC_JOB_ID,
        { pattern: CrewCashDistributionService.STALE_SYNC_CRON, tz: CrewCashDistributionService.STALE_SYNC_TZ },
        { name: JOB_NAMES.SYNC_STALE_CREW_CASH, opts: { removeOnComplete: 30, removeOnFail: 20 } },
      );
      this.logger.log(
        `Stale crew-cash sync scheduled (${CrewCashDistributionService.STALE_SYNC_CRON} ${CrewCashDistributionService.STALE_SYNC_TZ})`,
      );
    } catch (err) {
      this.logger.error(
        `Failed to schedule stale crew-cash sync: ${(err as Error)?.message ?? String(err)}`,
        (err as Error)?.stack,
      );
    }
  }

  /**
   * Nightly sweep: syncs Crew Cash rows into the Payroll Ledger for sheets
   * whose calendar day has fully passed but that are still open (see class
   * doc comment). Scoped to `date < startOfToday` so a sheet from today —
   * which may still be mid-trip — is never touched; only genuinely stale
   * sheets are swept. `isClosed` is deliberately left alone here.
   *
   * There is no human actor for an automated sweep, but the audit trail
   * (`CrewCashDistributionAuditLog.actorId`) requires a real `User` FK. The
   * sheet's own driver is used — the same default identity already relied on
   * elsewhere for a sheet's crew (`isTodaysCrewMember`) — rather than
   * inventing a synthetic system user.
   */
  async syncStaleSheets(): Promise<{ sheetsSynced: number; sheetsFailed: number; rowsSynced: number }> {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const staleSheets = await this.prisma.dailySheet.findMany({
      where: {
        isClosed: false,
        date: { lt: startOfToday },
        crewCashDistributions: { some: { syncedAt: null } },
      },
      select: { id: true, vendorId: true, driverId: true },
    });

    let sheetsSynced = 0;
    let sheetsFailed = 0;
    let rowsSynced = 0;

    for (const sheet of staleSheets) {
      try {
        const result = await this.prisma.$transaction((tx) =>
          this.syncSheetToLedger(tx, sheet.vendorId, sheet.id, sheet.driverId, UserRole.DRIVER),
        );
        rowsSynced += result.synced;
        sheetsSynced++;
      } catch (err) {
        sheetsFailed++;
        this.logger.error(`Stale crew-cash sync failed for sheet ${sheet.id}`, (err as Error)?.stack);
      }
    }

    this.logger.log(
      `Stale crew-cash sync complete: ${sheetsSynced}/${staleSheets.length} sheet(s) processed, ${rowsSynced} row(s) synced into the Payroll Ledger${sheetsFailed > 0 ? `, ${sheetsFailed} failed` : ''}`,
    );

    return { sheetsSynced, sheetsFailed, rowsSynced };
  }

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

    // Trip feature: same active-trip attribution ExpenseService.create uses —
    // inferred server-side, never an API param. Crew cash has no paidFromCash
    // toggle (it's unconditionally physical van cash), so every row is
    // deductible; this only tells the UI/PDF WHICH trip's numbers to reduce.
    const activeLoad = await this.prisma.dailySheetLoad.findFirst({
      where: { dailySheetId, endedAt: null },
    });
    const dailySheetLoadId = activeLoad?.id ?? null;

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
          dailySheetLoadId,
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
   * like every other mutation here. If the entry's sheet already closed by
   * the time approval lands (the close-time sweep skips unapproved rows),
   * this immediately syncs just this one row instead of leaving it stranded
   * — see the class doc comment.
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

      let updated = await tx.crewCashDistribution.findUniqueOrThrow({ where: { id } });

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

      const sheet = await tx.dailySheet.findUnique({
        where: { id: updated.dailySheetId },
        select: { isClosed: true },
      });
      if (sheet?.isClosed) {
        updated = await this.syncOneRow(tx, user.vendorId, updated, user.userId, user.role);
      }

      return updated;
    });
  }

  /**
   * Sweeps every not-yet-synced Crew Cash row on a sheet into the Payroll
   * Ledger. Takes an ALREADY-OPEN transaction client — composes into
   * `DailySheetService.closeSheet()`'s own transaction rather than opening
   * its own, so the `isClosed` flip and the sync can never partially commit
   * relative to each other. Rows still awaiting approval are left alone —
   * they sync individually the moment they're approved (see `approve`).
   */
  async syncSheetToLedger(
    tx: Prisma.TransactionClient,
    vendorId: string,
    dailySheetId: string,
    actorId: string,
    actorRole: UserRole,
  ): Promise<{ synced: number; skippedPendingApproval: number }> {
    const rows = await tx.crewCashDistribution.findMany({
      where: { vendorId, dailySheetId, syncedAt: null },
    });

    let synced = 0;
    let skippedPendingApproval = 0;

    for (const row of rows) {
      if (row.requiresApproval && row.approvedAt === null) {
        skippedPendingApproval++;
        continue;
      }

      // Redundant with the `syncedAt: null` filter above (a row can't have
      // syncedLedgerEntryId set while syncedAt is still null in this
      // service's own write path) — kept anyway as cheap defense-in-depth
      // against ever creating a second Ledger Entry for the same row.
      if (row.syncedLedgerEntryId !== null) {
        continue;
      }

      await this.syncOneRow(tx, vendorId, row, actorId, actorRole);
      synced++;
    }

    return { synced, skippedPendingApproval };
  }

  /**
   * Creates the one `StaffLedgerEntry` a Crew Cash row syncs into (a debit —
   * negative amount, mirroring the source row's positive magnitude), marks
   * the row synced, and writes the SYNCED audit log — the shared core used
   * by both `syncSheetToLedger` (bulk, at close) and `approve` (single row,
   * post-close approval). `status: POSTED` deliberately bypasses
   * `PayrollApprovalGateService` — Crew Cash already ran its own upstream
   * approval gate before this row was ever eligible to sync, so re-running
   * the ledger's own gate here would double-gate the same money.
   */
  private async syncOneRow(
    tx: Prisma.TransactionClient,
    vendorId: string,
    row: CrewCashDistribution,
    actorId: string,
    actorRole: UserRole,
  ): Promise<CrewCashDistribution> {
    const ledgerEntry = await tx.staffLedgerEntry.create({
      data: {
        vendorId,
        userId: row.employeeId,
        category: StaffLedgerCategory.CREW_CASH,
        amount: -row.amount,
        effectiveDate: row.date,
        description: `Crew Cash — ${row.category}${row.notes ? `: ${row.notes}` : ''}`,
        status: LedgerEntryStatus.POSTED,
        createdById: actorId,
      },
    });

    const synced = await tx.crewCashDistribution.update({
      where: { id: row.id },
      data: { syncedAt: new Date(), syncedLedgerEntryId: ledgerEntry.id },
    });

    await tx.crewCashDistributionAuditLog.create({
      data: {
        crewCashDistributionId: row.id,
        actorId,
        actorRole,
        action: CrewCashAuditAction.SYNCED,
        afterJson: { syncedLedgerEntryId: ledgerEntry.id, syncedAt: synced.syncedAt },
      },
    });

    return synced;
  }

  /**
   * Post-sync correction (doc §9) for an already-synced Crew Cash
   * Distribution row. The row's OWN data fields (`category`/`amount`/
   * `employeeId`/`syncedLedgerEntryId`) are never rewritten here — it stays
   * permanently paired with the ORIGINAL `StaffLedgerEntry` it produced; the
   * correction is a ledger-level fact, traceable via the linked entry's own
   * reversal/correction chain plus this method's own audit log row.
   *
   * `StaffLedgerService.correct()` hardcodes the fresh corrected entry's
   * `userId` to the original entry's `userId` — it structurally cannot
   * reassign an entry to a different employee (see its own doc comment), so
   * "wrong amount/category" and "wrong employee" are two different
   * compositions of the same three Phase 1 primitives, further split by
   * whether the linked entry is still pre-lock (`payrollEntryId === null`,
   * `correct`/`reverse` both reject that) or already rolled into a locked
   * payroll period:
   *   - not yet locked            → `voidEntryTx` the original + `createTx` a
   *     fresh replacement (right employee/category/amount either way).
   *   - locked, same employee     → `correctTx` (its native mechanic).
   *   - locked, different employee → `reverseTx` the original (stays
   *     attributed to whoever it mistakenly charged — that's correct, see
   *     doc §9) + a SEPARATE `createTx` for the right employee.
   *
   * All three branches run inside ONE transaction — `voidEntryTx`/
   * `reverseTx`/`correctTx`/`createTx` are the tx-parameterized cores added
   * to `StaffLedgerService` for exactly this composition (see its `createTx`
   * doc comment): calling the public `voidEntry`/`reverse`/`correct`/
   * `create` methods instead would each open their OWN separate
   * `$transaction`, so a failure between two of them (e.g. voided-but-
   * no-replacement-created) would be a real partial-application bug, not
   * just a style preference.
   */
  async correctSyncedEntry(user: AuthUser, id: string, dto: CorrectCrewCashDistributionDto) {
    if (dto.newEmployeeId === undefined && dto.newCategory === undefined && dto.newAmount === undefined) {
      throw new BadRequestException(
        'At least one of newEmployeeId, newCategory, or newAmount must be provided — a correction that changes nothing is not a correction.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const row = await tx.crewCashDistribution.findFirst({ where: { id, vendorId: user.vendorId } });
      if (!row) throw new NotFoundException('Crew Cash Distribution entry not found.');

      if (row.syncedLedgerEntryId === null) {
        throw new BadRequestException(
          'This entry has not yet synced into the Payroll Ledger — use update()/remove() for pre-sync corrections instead.',
        );
      }

      const ledgerEntry = await tx.staffLedgerEntry.findUniqueOrThrow({ where: { id: row.syncedLedgerEntryId } });

      const isReassignment = dto.newEmployeeId !== undefined && dto.newEmployeeId !== row.employeeId;
      const targetEmployeeId = dto.newEmployeeId ?? row.employeeId;
      const targetCategory = dto.newCategory ?? row.category;
      const targetAmount = dto.newAmount ?? row.amount;

      if (isReassignment) {
        const targetEmployee = await tx.user.findFirst({
          where: { id: targetEmployeeId, vendorId: user.vendorId },
          select: { id: true },
        });
        if (!targetEmployee) throw new NotFoundException('The reassignment target employee was not found.');
      }

      const beforeJson = {
        syncedLedgerEntryId: ledgerEntry.id,
        employeeId: row.employeeId,
        category: row.category,
        amount: row.amount,
        ledgerEntryStatus: ledgerEntry.status,
        ledgerEntryPayrollEntryId: ledgerEntry.payrollEntryId,
      };

      let action: CrewCashAuditAction;
      let afterJson: Prisma.InputJsonValue;

      if (ledgerEntry.payrollEntryId === null) {
        // Not yet locked — correct()/reverse() both REQUIRE payrollEntryId
        // !== null and would reject here (see their own doc comments);
        // voidEntry() is the primitive actually scoped to this window.
        await this.staffLedger.voidEntryTx(tx, user, ledgerEntry.id, {
          version: ledgerEntry.version,
          reason: dto.reason,
        });
        const fresh = await this.createFreshLedgerEntry(tx, user, row, targetEmployeeId, targetCategory, targetAmount, dto.reason);

        action = CrewCashAuditAction.CORRECTED;
        afterJson = {
          voidedLedgerEntryId: ledgerEntry.id,
          freshLedgerEntryId: fresh.id,
          employeeId: targetEmployeeId,
          category: targetCategory,
          amount: targetAmount,
        };
      } else if (!isReassignment) {
        // Locked, same employee — StaffLedgerService.correct()'s native
        // mechanic (reversal + fresh CORRECTION entry, both attributed to
        // `original.userId` — fine here since the employee is unchanged).
        const { correction } = await this.staffLedger.correctTx(tx, user, ledgerEntry.id, {
          version: ledgerEntry.version,
          reason: dto.reason,
          correctedAmount: -targetAmount,
        });

        action = CrewCashAuditAction.CORRECTED;
        afterJson = {
          correctionLedgerEntryId: correction.id,
          employeeId: targetEmployeeId,
          category: targetCategory,
          amount: targetAmount,
        };
      } else {
        // Locked, wrong employee — correct() cannot reassign userId, so this
        // is reverse() against the original mistaken entry (stays attributed
        // to whoever it mistakenly charged, per doc §9) followed by a
        // SEPARATE fresh entry for the right employee.
        await this.staffLedger.reverseTx(tx, user, ledgerEntry.id, {
          version: ledgerEntry.version,
          reason: dto.reason,
        });
        const fresh = await this.createFreshLedgerEntry(tx, user, row, targetEmployeeId, targetCategory, targetAmount, dto.reason);

        action = CrewCashAuditAction.REVERSED;
        afterJson = {
          reversedLedgerEntryId: ledgerEntry.id,
          freshLedgerEntryId: fresh.id,
          employeeId: targetEmployeeId,
          category: targetCategory,
          amount: targetAmount,
        };
      }

      // The row's own data fields are deliberately left untouched — see this
      // method's doc comment. syncedLedgerEntryId also keeps pointing at the
      // ORIGINAL entry; it is not repointed to whichever entry now carries
      // the corrected numbers.
      await tx.crewCashDistributionAuditLog.create({
        data: {
          crewCashDistributionId: row.id,
          actorId: user.userId,
          actorRole: user.role,
          action,
          reason: dto.reason,
          beforeJson,
          afterJson,
        },
      });

      return tx.crewCashDistribution.findUniqueOrThrow({ where: { id: row.id } });
    });
  }

  /**
   * Builds the fresh replacement `StaffLedgerEntry` shared by
   * `correctSyncedEntry`'s not-yet-locked branch (after `voidEntryTx`) and
   * its locked+wrong-employee branch (after `reverseTx`) — same debit shape
   * `syncOneRow` uses for the original sync, re-dated to "now" (this is a
   * correction happening later, not a backdated re-sync). Goes through
   * `StaffLedgerService.createTx` (not a raw `tx.staffLedgerEntry.create`
   * like `syncOneRow`), so — unlike the original sync, which deliberately
   * bypasses the ledger's own approval gate — a correction that pushes the
   * new amount over threshold is still gated like any other manually-created
   * ledger entry.
   */
  private async createFreshLedgerEntry(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    row: CrewCashDistribution,
    employeeId: string,
    category: CrewCashCategory,
    amount: number,
    reason: string,
  ) {
    return this.staffLedger.createTx(tx, user, {
      userId: employeeId,
      category: StaffLedgerCategory.CREW_CASH,
      amount: -amount,
      effectiveDate: new Date().toISOString(),
      description: `Crew Cash correction (was ${row.category} ${row.amount} for ${row.employeeId}) — ${category}: ${reason}`,
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
