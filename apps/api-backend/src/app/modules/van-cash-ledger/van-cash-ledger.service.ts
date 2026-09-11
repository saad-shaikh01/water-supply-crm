import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import {
  DailySheetKind,
  DiscrepancyCaseStatus,
  DiscrepancyType,
  LedgerEntryStatus,
  OfficeCashRemittance,
  OfficeCashRemittanceDestination,
  OfficeCashRemittanceStatus,
  Prisma,
  StaffLedgerCategory,
  VanCashHandover,
  VanCashHandoverStatus,
} from '@prisma/client';
import type { AuthUser } from '@water-supply-crm/types';
import { paginate, type PaginatedResult } from '../../common/helpers/paginate';
import { AuditService } from '../audit/audit.service';
import { PermissionService } from '../authz/permission.service';
import { resolveSheetCash, SHEET_CASH_RELOAD_INCLUDE } from '../daily-sheet/sheet-cash.util';
import {
  normalizeExpenseRow,
  normalizeStaffLedgerRow,
  shortSheetId,
  type ExpenseCenterRow,
} from '../expense-center/expense-center-domain.util';
import { SetOpeningBalanceDto } from './dto/set-opening-balance.dto';
import { ApproveHandoverDto } from './dto/approve-handover.dto';
import { CreateRemittanceDto } from './dto/create-remittance.dto';
import { ApproveRemittanceDto } from './dto/approve-remittance.dto';
import { VoidRemittanceDto } from './dto/void-remittance.dto';
import { CorrectRemittanceDto } from './dto/correct-remittance.dto';
import { VanCashLedgerStatsQueryDto, VanCashLedgerTimelineQueryDto } from './dto/van-cash-ledger-query.dto';

function versionMismatch(expected: number, received: number): ConflictException {
  return new ConflictException(`Version mismatch: expected ${expected}, received ${received}. Reload and retry.`);
}

/** Money is reported to 2dp — float sums otherwise leak 0.30000000000000004-style noise. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function endOfDay(date: Date): Date {
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return end;
}

function buildDateFilter(from?: Date, to?: Date): { gte?: Date; lte?: Date } | undefined {
  if (!from && !to) return undefined;
  const filter: { gte?: Date; lte?: Date } = {};
  if (from) filter.gte = from;
  if (to) filter.lte = to;
  return filter;
}

export type VanCashLedgerRowType =
  | 'OPENING_BALANCE'
  | 'CASH_IN'
  | 'CASH_IN_CORRECTION'
  | 'CASH_OUT'
  | 'CASH_REMITTANCE_OUT';

export interface VanCashLedgerRow {
  /** `${type}:${originalId}` — stable and unique across the merged sources. */
  id: string;
  date: string;
  type: VanCashLedgerRowType;
  /**
   * SIGNED contribution to the running balance — positive for cash in
   * (OPENING_BALANCE / CASH_IN), negative for cash out. A CASH_IN_CORRECTION
   * carries the row's own DELTA verbatim, which may itself be negative (a
   * downward adjustment reduces the balance even though its `type` is still
   * "cash in family", not "cash out") — `displayAmount` is always the
   * magnitude for UI, `amount` is what the running-balance fold actually uses.
   */
  amount: number;
  displayAmount: number;
  /** Filled in by the running-balance fold in getTimeline — 0 until then. */
  runningBalance: number;
  title: string;
  vanId: string | null;
  vanPlateNumber: string | null;
  sourceType: string;
  sourceRecordId: string;
  sourceBadge: string;
  /**
   * Only meaningful for CASH_IN / CASH_IN_CORRECTION — always 'APPROVED' in
   * practice here, since getTimeline only ever queries APPROVED handovers
   * (a PENDING one has no place in a settled running balance; it surfaces
   * instead via getPendingHandovers / the Pending Approvals panel). Carried
   * through anyway for type-consistency with that endpoint's rows and so a
   * future change to what getTimeline queries doesn't silently break the
   * frontend's status check.
   */
  status: VanCashHandoverStatus | null;
  dailySheetId: string | null;
  submittedByName: string | null;
  approvedByName: string | null;
  /** Optimistic-concurrency token for the approve action — null where not applicable (opening balance / cash-out rows are never approved from here). */
  version: number | null;
  /**
   * CASH_REMITTANCE_OUT only — true when this office->owner handover has been
   * VOIDED. A voided row is still shown in the timeline (struck-through, with
   * `voidReason`) for the audit trail, but contributes 0 to the running
   * balance. `false`/omitted for every other row type.
   */
  isVoided?: boolean;
  /** CASH_REMITTANCE_OUT only — the mandatory reason captured when the row was voided. */
  voidReason?: string | null;
  /**
   * CASH_REMITTANCE_OUT only — true when this row is a DELTA correction row
   * (`correctsEntryId != null`), not the root of a logical remittance. The
   * frontend uses this to keep the "Correct" action off correction rows, where
   * a per-row amount would be mistaken for the chain total.
   */
  isCorrection?: boolean;
}

export interface VanCashLedgerStats {
  totalExpense: number;
  totalCashIn: number;
  availableBalance: number;
  pendingHandoverCount: number;
  /** Date-range scoped — sum of APPROVED office->owner remittances in the window. */
  totalRemitted: number;
  /** NOT date-range scoped — count of PENDING office->owner remittances awaiting approval. */
  pendingRemittanceCount: number;
}

/**
 * Van Cash Ledger — the "cash in" counterpart to the Expense Center
 * (docs reference: CrewCashDistributionService is the architectural template —
 * source record -> pending -> approve -> posted, self-relation for post-close
 * corrections, check-then-create idempotency, per-action audit trail via the
 * generic AuditService rather than a dedicated audit table).
 *
 * `createHandoverForClosedSheet` / `handlePostCloseCorrection` are the two
 * write hooks other modules call INTO this service from inside their own
 * `$transaction` — see the call sites in DailySheetService (closeSheet /
 * approveClose, right alongside CrewCashDistributionService.syncSheetToLedger)
 * and ExpenseService (correctClosed / voidClosed / createClosed, right
 * alongside the postCloseExpenseCorrectionCount bump).
 */
@Injectable()
export class VanCashLedgerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly permissions: PermissionService,
  ) {}

  // ── Opening balance ───────────────────────────────────────────────────────

  async setOpeningBalance(user: AuthUser, dto: SetOpeningBalanceDto) {
    const van = await this.prisma.van.findFirst({ where: { id: dto.vanId, vendorId: user.vendorId } });
    if (!van) throw new NotFoundException('Van not found.');

    const before = await this.prisma.vanCashOpeningBalance.findUnique({ where: { vanId: dto.vanId } });

    const upserted = await this.prisma.vanCashOpeningBalance.upsert({
      where: { vanId: dto.vanId },
      create: {
        vendorId: user.vendorId,
        vanId: dto.vanId,
        openingBalance: dto.openingBalance,
        openingDate: new Date(dto.openingDate),
        setById: user.userId,
      },
      update: {
        openingBalance: dto.openingBalance,
        openingDate: new Date(dto.openingDate),
        setById: user.userId,
      },
    });

    await this.audit.log({
      vendorId: user.vendorId,
      userId: user.userId,
      userName: user.name,
      action: before ? 'UPDATED' : 'CREATED',
      entity: 'VanCashOpeningBalance',
      entityId: upserted.id,
      changes: {
        before: before ? { openingBalance: before.openingBalance, openingDate: before.openingDate } : undefined,
        after: { openingBalance: upserted.openingBalance, openingDate: upserted.openingDate },
      },
    });

    return upserted;
  }

  // ── Hook #1: sheet close ─────────────────────────────────────────────────

  /**
   * Called FROM inside DailySheetService's close transaction (closeSheet /
   * approveClose), in the exact same place `CrewCashDistributionService.
   * syncSheetToLedger` is called — a sheet can never end up closed with its
   * cash handover only partially created.
   *
   * Reads the sheet's final reconciled cash figure via `resolveSheetCash`
   * (which itself delegates to `buildReconciliation` for a freshly-closed,
   * unmodified sheet — see sheet-cash.util.ts). Skips creating anything when
   * that figure is 0 (no meaningful cash event — e.g. an all-monthly route
   * with nothing collected). WALK_IN sheets post their handover already
   * APPROVED (no office review needed for a synthetic self-pickup sheet with
   * no real driver custody handoff); every other sheet starts PENDING.
   */
  async createHandoverForClosedSheet(
    tx: Prisma.TransactionClient,
    vendorId: string,
    sheetId: string,
  ): Promise<VanCashHandover | null> {
    const sheet = await tx.dailySheet.findUnique({
      where: { id: sheetId },
      include: SHEET_CASH_RELOAD_INCLUDE,
    });
    if (!sheet) return null;

    const resolved = resolveSheetCash(sheet as unknown as Record<string, unknown>);
    if (resolved.cashExpected === 0) return null;

    // Check-then-create idempotency guard, same discipline
    // CrewCashDistributionService's own duplicate-guard comment documents —
    // only the ORIGINAL (non-correction) handover is guarded; a correction
    // row legitimately shares its parent's dailySheetId.
    const existing = await tx.vanCashHandover.findFirst({
      where: { dailySheetId: sheetId, correctsEntryId: null },
    });
    if (existing) return existing;

    const sheetRow = sheet as unknown as {
      vanId: string;
      driverId: string;
      date: Date;
      kind: DailySheetKind;
    };
    const isWalkIn = sheetRow.kind === DailySheetKind.WALK_IN;

    return tx.vanCashHandover.create({
      data: {
        vendorId,
        vanId: sheetRow.vanId,
        dailySheetId: sheetId,
        amount: resolved.cashExpected,
        submittedById: sheetRow.driverId,
        date: sheetRow.date,
        status: isWalkIn ? VanCashHandoverStatus.APPROVED : VanCashHandoverStatus.PENDING,
        approvedAt: isWalkIn ? new Date() : null,
        approvedById: null,
      },
    });
  }

  // ── Hook #2: post-close correction ──────────────────────────────────────

  /**
   * Called from wherever the post-close expense/cash correction flow
   * recomputes a closed sheet's cash figure — today that is
   * `ExpenseService.correctClosed` / `voidClosed` / `createClosed`, right
   * alongside their own `postCloseExpenseCorrectionCount` bump, inside the
   * SAME transaction.
   *
   * Sums the sheet's existing handover chain (original + any prior
   * corrections) to get the currently-recorded total, and reconciles it
   * against `newCashAmount` (the caller's freshly recomputed
   * `resolveSheetCash(...).cashExpected`):
   *   - delta === 0                              → no-op.
   *   - no handover exists yet (delta seed)       → the original close-time
   *     amount was 0 (skipped by createHandoverForClosedSheet) but the
   *     correction makes it non-zero; seed a fresh row rather than silently
   *     dropping the cash event.
   *   - original still PENDING (nothing approved) → rewrite its `amount` in
   *     place — there is nothing downstream to keep honest yet.
   *   - original APPROVED (or a correction chain already exists) → append a
   *     new correction row carrying the DELTA, auto-approved (a
   *     system-generated correction of an already-accepted fact, not a fresh
   *     request), dated the sheet's own date.
   */
  async handlePostCloseCorrection(
    tx: Prisma.TransactionClient,
    vendorId: string,
    sheetId: string,
    newCashAmount: number,
  ): Promise<VanCashHandover | null> {
    const chain = await tx.vanCashHandover.findMany({
      where: { vendorId, dailySheetId: sheetId },
      orderBy: { createdAt: 'asc' },
    });

    if (chain.length === 0) {
      if (newCashAmount === 0) return null;

      const sheet = await tx.dailySheet.findUnique({
        where: { id: sheetId },
        select: { vanId: true, driverId: true, date: true, kind: true },
      });
      if (!sheet) throw new NotFoundException('Daily sheet not found.');
      const isWalkIn = sheet.kind === DailySheetKind.WALK_IN;

      const seeded = await tx.vanCashHandover.create({
        data: {
          vendorId,
          vanId: sheet.vanId,
          dailySheetId: sheetId,
          amount: newCashAmount,
          submittedById: sheet.driverId,
          date: sheet.date,
          status: isWalkIn ? VanCashHandoverStatus.APPROVED : VanCashHandoverStatus.PENDING,
          approvedAt: isWalkIn ? new Date() : null,
          approvedById: null,
        },
      });

      await this.audit.log({
        vendorId,
        action: 'CORRECTED',
        entity: 'VanCashHandover',
        entityId: seeded.id,
        changes: { after: { seeded: true, amount: newCashAmount, dailySheetId: sheetId } },
      });

      return seeded;
    }

    const currentTotal = round2(chain.reduce((sum, row) => sum + row.amount, 0));
    const delta = round2(newCashAmount - currentTotal);
    if (delta === 0) return null;

    const original = chain.find((row) => row.correctsEntryId === null) ?? chain[0];
    const mostRecent = chain[chain.length - 1];

    if (original.status === VanCashHandoverStatus.PENDING && chain.length === 1) {
      const updated = await tx.vanCashHandover.update({
        where: { id: original.id },
        data: { amount: newCashAmount, version: { increment: 1 } },
      });

      await this.audit.log({
        vendorId,
        action: 'CORRECTED',
        entity: 'VanCashHandover',
        entityId: original.id,
        changes: { before: { amount: original.amount }, after: { amount: updated.amount } },
      });

      return updated;
    }

    const correction = await tx.vanCashHandover.create({
      data: {
        vendorId,
        vanId: mostRecent.vanId,
        dailySheetId: sheetId,
        amount: delta,
        submittedById: mostRecent.submittedById,
        date: mostRecent.date,
        // Auto-approved — a system-generated correction of an already-accepted
        // fact, not a fresh request that needs office review.
        status: VanCashHandoverStatus.APPROVED,
        approvedAt: new Date(),
        approvedById: null,
        correctsEntryId: mostRecent.id,
      },
    });

    await this.audit.log({
      vendorId,
      action: 'CORRECTED',
      entity: 'VanCashHandover',
      entityId: correction.id,
      changes: {
        before: { currentTotal },
        after: { newCashAmount, delta, correctsEntryId: mostRecent.id },
      },
    });

    return correction;
  }

  // ── Approval ─────────────────────────────────────────────────────────────

  async approveHandover(user: AuthUser, id: string, dto: ApproveHandoverDto) {
    const { updated, previousStatus } = await this.prisma.$transaction(async (tx) => {
      const handover = await tx.vanCashHandover.findFirst({ where: { id, vendorId: user.vendorId } });
      if (!handover) throw new NotFoundException('Van cash handover not found.');
      if (handover.status !== VanCashHandoverStatus.PENDING) {
        throw new BadRequestException('Only a PENDING handover can be approved.');
      }

      const unresolvedDiscrepancy = await tx.sheetDiscrepancyCase.findFirst({
        where: {
          vendorId: user.vendorId,
          dailySheetId: handover.dailySheetId,
          type: DiscrepancyType.CASH,
          status: DiscrepancyCaseStatus.REPORTED,
        },
        select: { id: true },
      });
      if (unresolvedDiscrepancy) {
        throw new BadRequestException("Resolve the sheet's cash discrepancy before approving this handover.");
      }

      const approvedAmount = dto.approvedAmount ?? handover.amount;
      const approvedAmountChanged = approvedAmount !== handover.amount;
      if (approvedAmountChanged && !dto.adjustmentReason) {
        throw new BadRequestException(
          'adjustmentReason is required when approvedAmount differs from the handover amount.',
        );
      }

      const claim = await tx.vanCashHandover.updateMany({
        where: { id, vendorId: user.vendorId, version: dto.version },
        data: {
          status: VanCashHandoverStatus.APPROVED,
          approvedById: user.userId,
          approvedAt: new Date(),
          approvedAmount,
          adjustmentReason: dto.adjustmentReason ?? null,
          version: { increment: 1 },
        },
      });
      if (claim.count === 0) {
        throw versionMismatch(handover.version, dto.version);
      }

      return {
        updated: await tx.vanCashHandover.findUniqueOrThrow({ where: { id } }),
        previousStatus: handover.status,
      };
    });

    await this.audit.log({
      vendorId: user.vendorId,
      userId: user.userId,
      userName: user.name,
      action: 'APPROVED',
      entity: 'VanCashHandover',
      entityId: id,
      changes: {
        before: { status: previousStatus },
        after: { status: updated.status, approvedAmount: updated.approvedAmount, adjustmentReason: updated.adjustmentReason },
      },
    });

    return updated;
  }

  // ── Office Cash Remittance (office -> owner / CEO / bank) ─────────────────
  //
  // The third cash-custody tier. Vendor-wide (no vanId — the office pool is
  // fungible once van handovers are APPROVED). Same lifecycle discipline as
  // VanCashHandover: PENDING -> APPROVED counts toward the balance; a post-
  // approval fix is a NEW row carrying the DELTA via correctsEntryId; a void is
  // a status flip, never a DELETE; optimistic concurrency via `version`.

  /**
   * Records a PENDING remittance. Over-remittance is a soft gate, never a hard
   * block (see the plan's real-world rationale): the row is always created, and
   * `wouldGoNegative` is returned so the caller can surface a warning / require
   * a note. `attachmentKey` is a Wasabi key already uploaded via the attachment
   * endpoint.
   */
  async createRemittance(user: AuthUser, dto: CreateRemittanceDto) {
    const availableBalance = round2(await this.computeAvailableBalance(user.vendorId));
    const wouldGoNegative = round2(availableBalance - dto.amount) < 0;

    // Over-remittance is a soft gate — allowed, but a note explaining the
    // shortfall is mandatory (plan §7). Enforced here so a direct API call
    // cannot bypass the dialog's client-side check.
    if (wouldGoNegative && !dto.note?.trim()) {
      throw new BadRequestException(
        `A note is required: this remittance exceeds recorded office cash (₨${availableBalance.toLocaleString()}) ` +
          `by ₨${round2(dto.amount - availableBalance).toLocaleString()}.`,
      );
    }

    const created = await this.prisma.officeCashRemittance.create({
      data: {
        vendorId: user.vendorId,
        submittedAmount: dto.amount,
        amount: dto.amount,
        date: new Date(dto.date),
        destination: dto.destination,
        destinationName: dto.destinationName ?? null,
        reference: dto.reference ?? null,
        attachmentKey: dto.attachmentKey ?? null,
        note: dto.note ?? null,
        status: OfficeCashRemittanceStatus.PENDING,
        submittedById: user.userId,
      },
    });

    await this.audit.log({
      vendorId: user.vendorId,
      userId: user.userId,
      userName: user.name,
      action: 'CREATED',
      entity: 'OfficeCashRemittance',
      entityId: created.id,
      changes: {
        after: {
          amount: created.amount,
          date: created.date,
          destination: created.destination,
          destinationName: created.destinationName,
          reference: created.reference,
          status: created.status,
        },
      },
    });

    return { ...created, wouldGoNegative, availableBalance };
  }

  /**
   * Approves a PENDING remittance. Mirrors approveHandover, plus:
   *   - segregation of duties — the recorder cannot approve their own row;
   *   - a soft negative-balance gate — if the approval drives office cash below
   *     zero, `negativeOverrideReason` is mandatory (but nothing is blocked once
   *     it is supplied).
   * When `approvedAmount` differs from the row's `amount`, `amount` is rewritten
   * to the approved value (the running balance and availableBalance both fold
   * `amount`, so the approved figure must land there) and the original amount is
   * preserved in the audit trail + `adjustmentReason`.
   */
  async approveRemittance(user: AuthUser, id: string, dto: ApproveRemittanceDto) {
    const { updated, previousStatus, previousAmount } = await this.prisma.$transaction(async (tx) => {
      const row = await tx.officeCashRemittance.findFirst({ where: { id, vendorId: user.vendorId } });
      if (!row) throw new NotFoundException('Office cash remittance not found.');
      if (row.status !== OfficeCashRemittanceStatus.PENDING) {
        throw new BadRequestException('Only a PENDING remittance can be approved.');
      }
      if (row.submittedById === user.userId) {
        throw new BadRequestException('You cannot approve a remittance you recorded yourself.');
      }

      const approvedAmount = dto.approvedAmount ?? row.amount;
      const approvedAmountChanged = approvedAmount !== row.amount;
      if (approvedAmountChanged && !dto.adjustmentReason) {
        throw new BadRequestException(
          'adjustmentReason is required when approvedAmount differs from the remittance amount.',
        );
      }

      // `computeAvailableBalance` counts only APPROVED remittances, so this row
      // (still PENDING) is not yet in it — the projection is simply
      // available - approvedAmount.
      const available = round2(await this.computeAvailableBalance(user.vendorId));
      const projected = round2(available - approvedAmount);
      if (projected < 0 && !dto.negativeOverrideReason) {
        throw new BadRequestException(
          `This approval drives office cash negative (₨${projected.toLocaleString()}). ` +
            'Provide negativeOverrideReason to proceed.',
        );
      }

      const claim = await tx.officeCashRemittance.updateMany({
        where: { id, vendorId: user.vendorId, version: dto.version },
        data: {
          status: OfficeCashRemittanceStatus.APPROVED,
          approvedById: user.userId,
          approvedAt: new Date(),
          approvedAmount,
          amount: approvedAmount,
          adjustmentReason: dto.adjustmentReason ?? null,
          negativeOverrideReason: dto.negativeOverrideReason ?? null,
          version: { increment: 1 },
        },
      });
      if (claim.count === 0) {
        throw versionMismatch(row.version, dto.version);
      }

      return {
        updated: await tx.officeCashRemittance.findUniqueOrThrow({ where: { id } }),
        previousStatus: row.status,
        previousAmount: row.amount,
      };
    });

    await this.audit.log({
      vendorId: user.vendorId,
      userId: user.userId,
      userName: user.name,
      action: 'APPROVED',
      entity: 'OfficeCashRemittance',
      entityId: id,
      changes: {
        before: { status: previousStatus, amount: previousAmount },
        after: {
          status: updated.status,
          amount: updated.amount,
          approvedAmount: updated.approvedAmount,
          adjustmentReason: updated.adjustmentReason,
          negativeOverrideReason: updated.negativeOverrideReason,
        },
      },
    });

    return updated;
  }

  /**
   * Voids a remittance (status flip to VOIDED — never a DELETE). SOP §8:
   *   - a still-PENDING row can be voided by its own creator (no extra grant
   *     needed) or by any `van_cash_ledger:remit_approve` holder;
   *   - an APPROVED row additionally requires `van_cash_ledger:remit_void`, and
   *     cannot be voided while it still has a live (non-voided) correction —
   *     the latest correction must be voided first (LIFO down the chain).
   */
  async voidRemittance(user: AuthUser, id: string, dto: VoidRemittanceDto) {
    const { updated, previousStatus } = await this.prisma.$transaction(async (tx) => {
      const row = await tx.officeCashRemittance.findFirst({ where: { id, vendorId: user.vendorId } });
      if (!row) throw new NotFoundException('Office cash remittance not found.');
      if (row.status === OfficeCashRemittanceStatus.VOIDED) {
        throw new BadRequestException('This remittance is already voided.');
      }

      if (row.status === OfficeCashRemittanceStatus.PENDING) {
        // A creator may always retract their own pending remittance; anyone
        // else needs approver authority.
        if (row.submittedById !== user.userId) {
          const isApprover = await this.permissions.can(user.userId, 'van_cash_ledger:remit_approve');
          if (!isApprover) {
            throw new ForbiddenException('You may only void a pending remittance you recorded yourself.');
          }
        }
      }

      if (row.status === OfficeCashRemittanceStatus.APPROVED) {
        const canVoidApproved = await this.permissions.can(user.userId, 'van_cash_ledger:remit_void');
        if (!canVoidApproved) {
          throw new ForbiddenException(
            'Voiding an already-approved remittance requires the van_cash_ledger:remit_void permission.',
          );
        }
        const liveCorrection = await tx.officeCashRemittance.findFirst({
          where: {
            vendorId: user.vendorId,
            correctsEntryId: id,
            status: { not: OfficeCashRemittanceStatus.VOIDED },
          },
          select: { id: true },
        });
        if (liveCorrection) {
          throw new BadRequestException('Void the latest correction on this remittance first.');
        }
      }

      const claim = await tx.officeCashRemittance.updateMany({
        where: { id, vendorId: user.vendorId, version: dto.version },
        data: {
          status: OfficeCashRemittanceStatus.VOIDED,
          voidedById: user.userId,
          voidedAt: new Date(),
          voidReason: dto.voidReason,
          version: { increment: 1 },
        },
      });
      if (claim.count === 0) {
        throw versionMismatch(row.version, dto.version);
      }

      return {
        updated: await tx.officeCashRemittance.findUniqueOrThrow({ where: { id } }),
        previousStatus: row.status,
      };
    });

    await this.audit.log({
      vendorId: user.vendorId,
      userId: user.userId,
      userName: user.name,
      action: 'VOIDED',
      entity: 'OfficeCashRemittance',
      entityId: id,
      changes: {
        before: { status: previousStatus },
        after: { status: updated.status, voidReason: updated.voidReason },
      },
    });

    return updated;
  }

  /**
   * Corrects a remittance chain. `newAmount` is the intended NEW TOTAL for the
   * whole logical remittance (root + every non-voided correction). Mirrors
   * handlePostCloseCorrection:
   *   - a still-PENDING standalone original (no chain) is rewritten in place;
   *   - otherwise a NEW row carrying the DELTA (`newAmount - currentTotal`) is
   *     appended, itself PENDING, going through its own approval cycle.
   */
  async correctRemittance(user: AuthUser, id: string, dto: CorrectRemittanceDto) {
    const result = await this.prisma.$transaction(async (tx) => {
      const chain = await this.loadRemittanceChain(tx, user.vendorId, id);
      if (chain.length === 0) throw new NotFoundException('Office cash remittance not found.');

      const target = chain.find((r) => r.id === id);
      if (!target) throw new NotFoundException('Office cash remittance not found.');
      if (chain.some((r) => r.status === OfficeCashRemittanceStatus.VOIDED && r.correctsEntryId === null)) {
        throw new BadRequestException('This remittance has been voided and cannot be corrected.');
      }
      if (target.version !== dto.version) {
        throw versionMismatch(target.version, dto.version);
      }

      const nonVoided = chain.filter((r) => r.status !== OfficeCashRemittanceStatus.VOIDED);
      const currentTotal = round2(nonVoided.reduce((sum, r) => sum + r.amount, 0));
      const delta = round2(dto.newAmount - currentTotal);
      if (delta === 0) {
        throw new BadRequestException('The corrected amount is the same as the current total.');
      }

      const root = chain[0];
      const mostRecent = nonVoided[nonVoided.length - 1] ?? root;
      const isInPlace = chain.length === 1 && root.status === OfficeCashRemittanceStatus.PENDING;

      // A creator may correct their OWN still-pending remittance in place with
      // no extra grant; every other case (someone else's pending row, or an
      // already-approved chain) needs approver authority.
      if (!(isInPlace && root.submittedById === user.userId)) {
        const isApprover = await this.permissions.can(user.userId, 'van_cash_ledger:remit_approve');
        if (!isApprover) {
          throw new ForbiddenException(
            isInPlace
              ? 'You may only correct a pending remittance you recorded yourself.'
              : 'Correcting an approved remittance requires the van_cash_ledger:remit_approve permission.',
          );
        }
      }

      // PENDING standalone original — rewrite in place. CAS on `version` so two
      // concurrent in-place corrections cannot both land (matches approve/void).
      if (isInPlace) {
        const claim = await tx.officeCashRemittance.updateMany({
          where: { id: root.id, vendorId: user.vendorId, version: dto.version },
          data: {
            amount: dto.newAmount,
            destinationName: dto.destinationName ?? root.destinationName,
            reference: dto.reference ?? root.reference,
            note: dto.correctionReason,
            version: { increment: 1 },
          },
        });
        if (claim.count === 0) {
          throw versionMismatch(root.version, dto.version);
        }
        const updated = await tx.officeCashRemittance.findUniqueOrThrow({ where: { id: root.id } });
        await this.audit.log({
          vendorId: user.vendorId,
          userId: user.userId,
          userName: user.name,
          action: 'CORRECTED',
          entity: 'OfficeCashRemittance',
          entityId: root.id,
          changes: {
            before: { amount: root.amount },
            after: { amount: updated.amount, correctionReason: dto.correctionReason },
          },
        });
        return updated;
      }

      // APPROVED original / existing chain — append a PENDING DELTA row.
      // CAS-bump the parent (`mostRecent`) first: two concurrent corrections of
      // the same parent then serialise, and the loser gets a version mismatch,
      // so a parent can never end up with two live children.
      const parentClaim = await tx.officeCashRemittance.updateMany({
        where: { id: mostRecent.id, vendorId: user.vendorId, version: mostRecent.version },
        data: { version: { increment: 1 } },
      });
      if (parentClaim.count === 0) {
        throw new ConflictException(
          'Version mismatch: this remittance was corrected concurrently. Reload and retry.',
        );
      }

      const correction = await tx.officeCashRemittance.create({
        data: {
          vendorId: user.vendorId,
          submittedAmount: delta,
          amount: delta,
          date: mostRecent.date,
          destination: mostRecent.destination,
          destinationName: dto.destinationName ?? mostRecent.destinationName,
          reference: dto.reference ?? mostRecent.reference,
          note: dto.correctionReason,
          status: OfficeCashRemittanceStatus.PENDING,
          submittedById: user.userId,
          correctsEntryId: mostRecent.id,
        },
      });
      await this.audit.log({
        vendorId: user.vendorId,
        userId: user.userId,
        userName: user.name,
        action: 'CORRECTED',
        entity: 'OfficeCashRemittance',
        entityId: correction.id,
        changes: {
          before: { currentTotal },
          after: {
            newAmount: dto.newAmount,
            delta,
            correctsEntryId: mostRecent.id,
            correctionReason: dto.correctionReason,
          },
        },
      });
      return correction;
    });

    return result;
  }

  // ── Reads ────────────────────────────────────────────────────────────────

  async getPendingHandovers(vendorId: string, vanId?: string) {
    return this.prisma.vanCashHandover.findMany({
      where: { vendorId, status: VanCashHandoverStatus.PENDING, ...(vanId && { vanId }) },
      include: {
        van: { select: { id: true, plateNumber: true } },
        submittedBy: { select: { id: true, name: true } },
        dailySheet: { select: { id: true, date: true } },
      },
      orderBy: { date: 'desc' },
    });
  }

  /** PENDING office->owner remittances awaiting approval (vendor-wide). */
  async getPendingRemittances(vendorId: string) {
    return this.prisma.officeCashRemittance.findMany({
      where: { vendorId, status: OfficeCashRemittanceStatus.PENDING },
      include: {
        submittedBy: { select: { id: true, name: true } },
      },
      orderBy: { date: 'desc' },
    });
  }

  /** Resolves a remittance's stored attachment key (vendor-scoped); 404 if the row or its attachment is missing. */
  async getRemittanceAttachmentKey(vendorId: string, id: string): Promise<string> {
    const row = await this.prisma.officeCashRemittance.findFirst({
      where: { id, vendorId },
      select: { attachmentKey: true },
    });
    if (!row) throw new NotFoundException('Office cash remittance not found.');
    if (!row.attachmentKey) throw new NotFoundException('This remittance has no attachment.');
    return row.attachmentKey;
  }

  async getStats(vendorId: string, query: VanCashLedgerStatsQueryDto): Promise<VanCashLedgerStats> {
    const { vanId } = query;
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? endOfDay(new Date(query.to)) : undefined;
    const dateFilter = buildDateFilter(from, to);

    const [cashInAgg, totalExpense, pendingHandoverCount, availableBalance, remittedAgg, pendingRemittanceCount] =
      await Promise.all([
        this.prisma.vanCashHandover.aggregate({
          where: {
            vendorId,
            status: VanCashHandoverStatus.APPROVED,
            ...(vanId && { vanId }),
            ...(dateFilter && { date: dateFilter }),
          },
          _sum: { amount: true },
        }),
        this.collectCashOutTotal(vendorId, vanId, dateFilter),
        this.prisma.vanCashHandover.count({
          where: { vendorId, status: VanCashHandoverStatus.PENDING, ...(vanId && { vanId }) },
        }),
        this.computeAvailableBalance(vendorId, vanId),
        // Office->owner remittances are vendor-wide — a van-scoped view of the
        // ledger does not attribute them (same treatment StaffLedgerEntry gets).
        vanId
          ? Promise.resolve({ _sum: { amount: 0 } } as { _sum: { amount: number | null } })
          : this.prisma.officeCashRemittance.aggregate({
              where: {
                vendorId,
                status: OfficeCashRemittanceStatus.APPROVED,
                ...(dateFilter && { date: dateFilter }),
              },
              _sum: { amount: true },
            }),
        vanId
          ? Promise.resolve(0)
          : this.prisma.officeCashRemittance.count({
              where: { vendorId, status: OfficeCashRemittanceStatus.PENDING },
            }),
      ]);

    return {
      totalCashIn: round2(cashInAgg._sum.amount ?? 0),
      totalExpense: round2(totalExpense),
      pendingHandoverCount,
      availableBalance: round2(availableBalance),
      totalRemitted: round2(remittedAgg._sum.amount ?? 0),
      pendingRemittanceCount,
    };
  }

  /**
   * Merged, date-ascending, paginated cash timeline for a van (or the whole
   * vendor). Unlike `ExpenseCenterService.getTimeline`'s bounded-window
   * fetch-then-merge (there is no way to compute a correct RUNNING BALANCE
   * from a bounded window without also knowing everything that came before
   * it), this fetches every row matching the filter and folds the running
   * balance once over the full sorted set before paginating the tail — an
   * accepted trade-off given Van Cash Ledger's volume (at most one handover
   * per van per day, plus its related cash-out rows) is orders of magnitude
   * smaller than the general Expense Center dataset this pattern was
   * designed for.
   *
   * CASH-OUT SCOPE — office cash only. A cash-paid Expense that belongs to a
   * Daily Sheet (or WALK_IN sheet) is ALREADY netted out of that sheet's
   * `VanCashHandover.amount` (= `resolveSheetCash().cashExpected` =
   * `netToHandIn` = cashRecorded − sheetExpenses − crewCash), so folding it in
   * again here would double-count it. We therefore include only Expense rows
   * with `dailySheetId: null` (recorded directly in the Expense Center) plus
   * StaffLedgerEntry (office payroll, never sheet-linked). CrewCashDistribution
   * is `dailySheetId`-mandatory and always inside a handover, so it is not a
   * source here at all.
   */
  async getTimeline(vendorId: string, query: VanCashLedgerTimelineQueryDto): Promise<PaginatedResult<VanCashLedgerRow>> {
    const { page = 1, limit = 20, vanId } = query;
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? endOfDay(new Date(query.to)) : undefined;
    const dateFilter = buildDateFilter(from, to);

    const [openingRows, cashInRows, expenseRows, ledgerRows, remittanceRows] = await Promise.all([
      this.buildOpeningBalanceRows(vendorId, vanId, to),
      this.prisma.vanCashHandover.findMany({
        where: {
          vendorId,
          status: VanCashHandoverStatus.APPROVED,
          ...(vanId && { vanId }),
          ...(dateFilter && { date: dateFilter }),
        },
        include: {
          van: { select: { plateNumber: true } },
          submittedBy: { select: { name: true } },
          approvedBy: { select: { name: true } },
        },
        orderBy: { date: 'asc' },
      }),
      this.prisma.expense.findMany({
        where: {
          vendorId,
          paidFromCash: true,
          // Sheet-linked expenses are already netted out of the sheet's
          // VanCashHandover — only Expense-Center-direct rows are office cash-out.
          dailySheetId: null,
          ...(vanId && { vanId }),
          ...(dateFilter && { date: dateFilter }),
        },
        select: {
          id: true,
          category: true,
          amount: true,
          paidFromCash: true,
          description: true,
          date: true,
          dailySheetId: true,
          fuelLog: { select: { id: true } },
          vehicleServiceRecord: { select: { id: true } },
          van: { select: { plateNumber: true } },
          createdBy: { select: { name: true } },
          dailySheet: { select: { isClosed: true } },
        },
        orderBy: { date: 'asc' },
      }),
      // StaffLedgerEntry has no van relation — same documented Expense Center
      // assumption applies here (a van-scoped view cannot attribute it).
      vanId
        ? Promise.resolve([])
        : this.prisma.staffLedgerEntry.findMany({
            where: {
              vendorId,
              category: { not: StaffLedgerCategory.CREW_CASH },
              status: { not: LedgerEntryStatus.VOIDED },
              ...(dateFilter && { effectiveDate: dateFilter }),
            },
            select: {
              id: true,
              category: true,
              amount: true,
              description: true,
              effectiveDate: true,
              user: { select: { name: true } },
              createdBy: { select: { name: true } },
              payrollEntryId: true,
            },
            orderBy: { effectiveDate: 'asc' },
          }),
      // NOTE: CrewCashDistribution is intentionally NOT a source here — every
      // crew-cash row is `dailySheetId`-mandatory and already netted out of that
      // sheet's VanCashHandover (see the CASH-OUT SCOPE note above).

      // Office->owner remittances are vendor-wide and cannot be attributed to a
      // single van — excluded from a van-scoped view (same treatment as
      // StaffLedgerEntry above). VOIDED rows are still fetched so the timeline
      // can show the struck-through audit row; they fold in as amount 0.
      vanId
        ? Promise.resolve([] as Array<
            OfficeCashRemittance & {
              submittedBy: { name: string } | null;
              approvedBy: { name: string } | null;
              voidedBy: { name: string } | null;
            }
          >)
        : this.prisma.officeCashRemittance.findMany({
            where: {
              vendorId,
              status: { in: [OfficeCashRemittanceStatus.APPROVED, OfficeCashRemittanceStatus.VOIDED] },
              ...(dateFilter && { date: dateFilter }),
            },
            include: {
              submittedBy: { select: { name: true } },
              approvedBy: { select: { name: true } },
              voidedBy: { select: { name: true } },
            },
            orderBy: { date: 'asc' },
          }),
    ]);

    const merged: VanCashLedgerRow[] = [...openingRows];
    for (const row of cashInRows) merged.push(this.normalizeCashIn(row));
    for (const row of expenseRows) merged.push(this.normalizeCashOut(normalizeExpenseRow(row)));
    for (const row of ledgerRows) merged.push(this.normalizeCashOut(normalizeStaffLedgerRow(row)));
    for (const row of remittanceRows) merged.push(this.normalizeRemittanceOut(row));

    merged.sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return a.id < b.id ? -1 : 1;
    });

    let running = 0;
    for (const row of merged) {
      running = round2(running + row.amount);
      row.runningBalance = running;
    }

    // Running balance is folded oldest→newest (each row's `runningBalance` is
    // the cumulative total up to and including it), but the timeline is DISPLAYED
    // newest-first — reverse the fully-folded set before paginating so page 1
    // carries the most recent movements with their balances intact.
    merged.reverse();

    const total = merged.length;
    const skip = (page - 1) * limit;
    return paginate(merged.slice(skip, skip + limit), total, page, limit);
  }

  // ── Internal helpers ─────────────────────────────────────────────────────

  /**
   * OFFICE cash-out total (mirrors `getTimeline`'s CASH-OUT SCOPE note):
   *   - `Expense` rows with `paidFromCash: true` AND `dailySheetId: null` — a
   *     card-paid expense never touched physical cash, and a sheet-linked one is
   *     already netted out of that sheet's VanCashHandover (double-count).
   *   - StaffLedgerEntry (office payroll, never sheet-linked, no `paidFromCash`
   *     concept — treated as always-cash, per expense-center.service.ts).
   * CrewCashDistribution is deliberately excluded — every row is sheet-linked
   * and already inside a handover.
   */
  private async collectCashOutTotal(
    vendorId: string,
    vanId: string | undefined,
    dateFilter?: { gte?: Date; lte?: Date },
  ): Promise<number> {
    const [expenseAgg, ledgerRows] = await Promise.all([
      this.prisma.expense.aggregate({
        where: {
          vendorId,
          paidFromCash: true,
          dailySheetId: null,
          ...(vanId && { vanId }),
          ...(dateFilter && { date: dateFilter }),
        },
        _sum: { amount: true },
      }),
      // StaffLedgerEntry has no van relation — excluded from a van-scoped total.
      vanId
        ? Promise.resolve([] as { amount: number }[])
        : this.prisma.staffLedgerEntry.findMany({
            where: {
              vendorId,
              category: { not: StaffLedgerCategory.CREW_CASH },
              status: { not: LedgerEntryStatus.VOIDED },
              ...(dateFilter && { effectiveDate: dateFilter }),
            },
            select: { amount: true },
          }),
    ]);

    const ledgerTotal = ledgerRows.reduce((sum, row) => sum + Math.abs(row.amount), 0);
    return (expenseAgg._sum.amount ?? 0) + ledgerTotal;
  }

  /**
   * The true current balance — opening balance + all approved cash-in to date
   * minus all cash-out to date, ignoring any `from`/`to` filter (only
   * `vanId`, when given, narrows it).
   *
   * Office->owner remittances are subtracted for the vendor-wide balance only:
   * they leave the shared office pool, not any one van's cash-in-hand, so a
   * van-scoped balance (which reports that single van's position) must not
   * count them.
   */
  private async computeAvailableBalance(vendorId: string, vanId?: string): Promise<number> {
    const [openingTotal, cashInAgg, cashOutTotal, remittedTotal] = await Promise.all([
      vanId
        ? this.prisma.vanCashOpeningBalance
            .findFirst({ where: { vendorId, vanId } })
            .then((row) => row?.openingBalance ?? 0)
        : this.prisma.vanCashOpeningBalance
            .aggregate({ where: { vendorId }, _sum: { openingBalance: true } })
            .then((agg) => agg._sum.openingBalance ?? 0),
      this.prisma.vanCashHandover.aggregate({
        where: { vendorId, status: VanCashHandoverStatus.APPROVED, ...(vanId && { vanId }) },
        _sum: { amount: true },
      }),
      this.collectCashOutTotal(vendorId, vanId, undefined),
      vanId
        ? Promise.resolve(0)
        : this.prisma.officeCashRemittance
            .aggregate({
              where: { vendorId, status: OfficeCashRemittanceStatus.APPROVED },
              _sum: { amount: true },
            })
            .then((agg) => agg._sum.amount ?? 0),
    ]);

    return openingTotal + (cashInAgg._sum.amount ?? 0) - cashOutTotal - remittedTotal;
  }

  /**
   * Opening-balance synthetic row(s) for the timeline (see class-level query
   * doc for the full contract). Per-van: the van's own opening balance row,
   * included when its `openingDate` falls at-or-before the visible range's
   * end. Company-wide (no van filter): ALL vans' opening balances summed into
   * ONE synthetic row labeled "Opening Balance (all vans)", included whenever
   * at least one van's `openingDate` is at-or-before the range end — dated at
   * the earliest contributing van's `openingDate` so it sorts first.
   */
  private async buildOpeningBalanceRows(
    vendorId: string,
    vanId: string | undefined,
    to: Date | undefined,
  ): Promise<VanCashLedgerRow[]> {
    if (vanId) {
      const row = await this.prisma.vanCashOpeningBalance.findFirst({ where: { vendorId, vanId } });
      if (!row) return [];
      if (to && row.openingDate > to) return [];
      const openingVan = await this.prisma.van.findUnique({ where: { id: vanId }, select: { plateNumber: true } });
      return [
        {
          id: `OPENING_BALANCE:${row.id}`,
          date: row.openingDate.toISOString(),
          type: 'OPENING_BALANCE',
          amount: row.openingBalance,
          displayAmount: Math.abs(row.openingBalance),
          runningBalance: 0,
          title: 'Opening Balance',
          vanId,
          vanPlateNumber: openingVan?.plateNumber ?? null,
          sourceType: 'OPENING_BALANCE',
          sourceRecordId: row.id,
          sourceBadge: 'Opening Balance',
          status: null,
          dailySheetId: null,
          submittedByName: null,
          approvedByName: null,
          version: null,
        },
      ];
    }

    const rows = await this.prisma.vanCashOpeningBalance.findMany({ where: { vendorId } });
    const eligible = rows.filter((row) => !to || row.openingDate <= to);
    if (eligible.length === 0) return [];

    const total = round2(eligible.reduce((sum, row) => sum + row.openingBalance, 0));
    const earliestDate = eligible.reduce(
      (min, row) => (row.openingDate < min ? row.openingDate : min),
      eligible[0].openingDate,
    );

    return [
      {
        id: 'OPENING_BALANCE:ALL',
        date: earliestDate.toISOString(),
        type: 'OPENING_BALANCE',
        amount: total,
        displayAmount: Math.abs(total),
        runningBalance: 0,
        title: 'Opening Balance (all vans)',
        vanId: null,
        vanPlateNumber: null,
        sourceType: 'OPENING_BALANCE',
        sourceRecordId: 'ALL',
        sourceBadge: 'Opening Balance (all vans)',
        status: null,
        dailySheetId: null,
        submittedByName: null,
        approvedByName: null,
        version: null,
      },
    ];
  }

  private normalizeCashIn(
    row: VanCashHandover & { van: { plateNumber: string }; submittedBy: { name: string } | null; approvedBy: { name: string } | null },
  ): VanCashLedgerRow {
    const isCorrection = row.correctsEntryId !== null;
    const badge = `via Daily Sheet #${shortSheetId(row.dailySheetId)}`;
    return {
      id: `${isCorrection ? 'CASH_IN_CORRECTION' : 'CASH_IN'}:${row.id}`,
      date: row.date.toISOString(),
      type: isCorrection ? 'CASH_IN_CORRECTION' : 'CASH_IN',
      // Signed — a downward correction can legitimately be negative even
      // though its type is still "cash in family" (see interface doc).
      amount: row.amount,
      displayAmount: Math.abs(row.amount),
      runningBalance: 0,
      title: isCorrection
        ? `Cash handover correction — Daily Sheet #${shortSheetId(row.dailySheetId)}`
        : `Cash handover — Daily Sheet #${shortSheetId(row.dailySheetId)}`,
      vanId: row.vanId,
      vanPlateNumber: row.van.plateNumber,
      sourceType: 'VAN_CASH_HANDOVER',
      sourceRecordId: row.id,
      sourceBadge: badge,
      status: row.status,
      dailySheetId: row.dailySheetId,
      submittedByName: row.submittedBy?.name ?? null,
      approvedByName: row.approvedBy?.name ?? null,
      version: row.version,
    };
  }

  private normalizeCashOut(row: ExpenseCenterRow): VanCashLedgerRow {
    return {
      id: `CASH_OUT:${row.id}`,
      date: row.date,
      type: 'CASH_OUT',
      amount: -row.amount,
      displayAmount: row.amount,
      runningBalance: 0,
      title: row.title,
      // ExpenseCenterRow carries no raw vanId/dailySheetId today — plateNumber
      // (already present) covers display, and van-scoping already happened
      // server-side via the query filter, so this is a display-only gap, not
      // a functional one. Revisit if ExpenseCenterRow ever exposes vanId.
      vanId: null,
      vanPlateNumber: row.vanPlateNumber,
      sourceType: row.sourceType,
      sourceRecordId: row.sourceRecordId,
      sourceBadge: row.sourceBadge,
      status: null,
      dailySheetId: null,
      submittedByName: row.recordedByName,
      approvedByName: null,
      version: null,
    };
  }

  /** Human label for a remittance's destination, folding in the free-text name where relevant. */
  private static destinationLabel(
    destination: OfficeCashRemittanceDestination,
    destinationName: string | null,
  ): string {
    switch (destination) {
      case OfficeCashRemittanceDestination.OWNER:
        return destinationName ? `Owner (${destinationName})` : 'Owner';
      case OfficeCashRemittanceDestination.CEO:
        return destinationName ? `CEO (${destinationName})` : 'CEO';
      case OfficeCashRemittanceDestination.BANK:
        return destinationName ? `Bank (${destinationName})` : 'Bank';
      default:
        return destinationName ?? 'Other';
    }
  }

  private normalizeRemittanceOut(
    row: OfficeCashRemittance & {
      submittedBy: { name: string } | null;
      approvedBy: { name: string } | null;
      voidedBy: { name: string } | null;
    },
  ): VanCashLedgerRow {
    const isVoided = row.status === OfficeCashRemittanceStatus.VOIDED;
    const isCorrection = row.correctsEntryId !== null;
    const label = VanCashLedgerService.destinationLabel(row.destination, row.destinationName);
    return {
      id: `CASH_REMITTANCE_OUT:${row.id}`,
      date: row.date.toISOString(),
      type: 'CASH_REMITTANCE_OUT',
      // A voided remittance is shown for the audit trail but must not move the
      // running balance — it folds in as 0. A correction row carries its own
      // signed DELTA (which may be negative for a downward adjustment).
      amount: isVoided ? 0 : -row.amount,
      displayAmount: Math.abs(row.amount),
      runningBalance: 0,
      title: isCorrection ? `Handover to ${label} — correction` : `Handover to ${label}`,
      vanId: null,
      vanPlateNumber: null,
      sourceType: 'OFFICE_CASH_REMITTANCE',
      sourceRecordId: row.id,
      sourceBadge: row.reference ? `Ref ${row.reference}` : label,
      status: null,
      dailySheetId: null,
      submittedByName: row.submittedBy?.name ?? null,
      approvedByName: row.approvedBy?.name ?? null,
      version: row.version,
      isVoided,
      voidReason: row.voidReason ?? null,
      isCorrection,
    };
  }

  /**
   * Loads the full logical remittance chain (root + every correction) that
   * `anyId` belongs to, in creation order. Corrections form a linear chain —
   * each points at the previous tip via `correctsEntryId` — so this walks up
   * to the root and then down through the descendants. Volume is tiny (a
   * handful of rows per logical remittance at most), the same trade-off the
   * class-level getTimeline doc calls out.
   */
  private async loadRemittanceChain(
    tx: Prisma.TransactionClient,
    vendorId: string,
    anyId: string,
  ): Promise<OfficeCashRemittance[]> {
    let cursor = await tx.officeCashRemittance.findFirst({ where: { id: anyId, vendorId } });
    if (!cursor) return [];

    // Walk up to the root.
    while (cursor.correctsEntryId) {
      const parent = await tx.officeCashRemittance.findFirst({
        where: { id: cursor.correctsEntryId, vendorId },
      });
      if (!parent) break;
      cursor = parent;
    }

    // Walk down through the (linear) descendant chain.
    const chain: OfficeCashRemittance[] = [cursor];
    let tip = cursor;
    for (;;) {
      const child = await tx.officeCashRemittance.findFirst({
        where: { correctsEntryId: tip.id, vendorId },
        orderBy: { createdAt: 'asc' },
      });
      if (!child) break;
      chain.push(child);
      tip = child;
    }
    return chain;
  }
}
