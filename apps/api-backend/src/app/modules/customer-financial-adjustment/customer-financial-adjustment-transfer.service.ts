import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  DeliveryStatus,
  Prisma,
  TransactionType,
  type CustomerFinancialAdjustment,
  type CustomerFinancialAdjustmentGroup,
  type Transaction,
} from '@prisma/client';
import { PrismaService } from '@water-supply-crm/database';
import { CacheInvalidationService, CACHE_KEYS } from '@water-supply-crm/caching';
import type { AuthUser } from '@water-supply-crm/types';
import { PermissionService } from '../authz/permission.service';
import { CreateBalanceTransferDto } from './dto/create-balance-transfer.dto';
import { TransferPreviewQueryDto } from './dto/transfer-preview-query.dto';
import {
  VOID_REASON_MIN_LENGTH,
  VoidCustomerFinancialAdjustmentDto,
} from './dto/void-customer-financial-adjustment.dto';
import {
  customerFacingReversalText,
  normalizeAdjustmentAmount,
  oppositeAdjustmentDirection,
  signedAdjustmentAmount,
} from './adjustment-posting.util';
import {
  TRANSFER_BALANCE_EPSILON,
  assertLegsNetZero,
  customerLockOrder,
  transferInTitle,
  transferLegDirection,
  transferOutTitle,
} from './adjustment-transfer.util';

/** RBAC actions (static strings — checked in the service, see the class doc). */
const TRANSFER_PERMISSION = 'customer_financial_adjustments:transfer' as const;
const VOID_PERMISSION = 'customer_financial_adjustments:void' as const;

const CUSTOMER_SELECT = {
  id: true,
  name: true,
  customerCode: true,
  isActive: true,
  financialBalance: true,
} satisfies Prisma.CustomerSelect;

const GROUP_WITH_LEGS = {
  adjustments: { include: { transaction: true } },
} satisfies Prisma.CustomerFinancialAdjustmentGroupInclude;
type LoadedGroup = Prisma.CustomerFinancialAdjustmentGroupGetPayload<{
  include: typeof GROUP_WITH_LEGS;
}>;

/** One side of a transfer: the adjustment document and the single ledger row it posted. */
export interface TransferLeg {
  adjustment: CustomerFinancialAdjustment;
  transaction: Transaction;
}

export interface CreateTransferResult {
  group: CustomerFinancialAdjustmentGroup;
  /** TRANSFER_OUT — the CREDIT leg on the customer whose balance was reduced. */
  sourceLeg: TransferLeg;
  /** TRANSFER_IN — the CHARGE leg on the customer whose balance increased. */
  targetLeg: TransferLeg;
  /** Right after this post on a fresh create; the LIVE balances when `idempotentReplay`. */
  sourceBalance: number;
  targetBalance: number;
  /** True when this key was already used with the same request: nothing new was posted. */
  idempotentReplay: boolean;
}

export interface VoidTransferResult {
  /** The group, now VOIDED. */
  group: CustomerFinancialAdjustmentGroup;
  /** The two original legs, now VOIDED. */
  voidedSourceLeg: CustomerFinancialAdjustment;
  voidedTargetLeg: CustomerFinancialAdjustment;
  /** Their reversals (document + exact-negation ledger row), dated the void moment. */
  sourceReversal: TransferLeg;
  targetReversal: TransferLeg;
  sourceBalance: number;
  targetBalance: number;
}

export interface TransferPreviewBlocker {
  code: 'SAME_CUSTOMER' | 'SOURCE_HAS_NO_BALANCE' | 'TARGET_INACTIVE';
  message: string;
}

/**
 * Customer Financial Adjustments — balance transfers (Phase 3, owner-approved 2026-09-21).
 *
 * A transfer moves part or all of what ONE customer OWES onto ANOTHER customer's
 * account. It is one `CustomerFinancialAdjustmentGroup` (type TRANSFER) with exactly
 * two adjustment documents — TRANSFER_OUT (a CREDIT on the source) and TRANSFER_IN (a
 * CHARGE on the target) — each with its own ledger row, so BOTH customers' statements
 * reconcile (the statement's opening/closing are back-derived from ledger sums, so a
 * transfer is never a side table).
 *
 * ATOMIC. `create` writes, in ONE database transaction, the group, the two customer
 * balance moves, the two documents, the two ledger rows and the audit rows, and asserts
 * the two ledger amounts net to exactly zero (paise). Any failure rolls all of it back.
 *
 * CONCURRENCY. The source decrement is CONDITIONAL — `updateMany where financialBalance
 * >= amount` — so two transfers racing for the same balance cannot both succeed: the
 * second waits on the row lock, re-evaluates against the new balance, matches 0 rows and
 * rolls back with a 409. The target increment is conditional on `isActive` for the same
 * reason (deactivated between the pre-check and the write). Customers are always
 * written in sorted-id order, so A→B racing B→A cannot deadlock.
 *
 * RULES. Same vendor for both customers (a foreign id is a 404, never revealed);
 * source ≠ target; the TARGET must be active, the SOURCE may be inactive (transfer the
 * balance, THEN deactivate — a zero balance avoids force-deactivate's write-off); the
 * amount cannot exceed what the source currently owes (credit-balance transfers are not
 * supported in V1). Always dated now. Customer-facing wording carries customer CODES
 * only, never the other party's name.
 *
 * VOID. `voidTransfer` reverses BOTH legs in one transaction (a single leg can never be
 * voided alone — CustomerFinancialAdjustmentService.voidAdjustment refuses group legs).
 * There is deliberately no balance floor: if the target has since paid down what was
 * transferred to it, voiding leaves that customer with a credit, which is the truth.
 *
 * Audit rows are written with `tx.auditLog` (AuditService is not tx-aware and swallows
 * its own errors, so it cannot be part of an atomic unit) and cache fan-out happens
 * AFTER commit, never fatal — the same conventions as CustomerFinancialAdjustmentService,
 * which this service deliberately does not modify.
 */
@Injectable()
export class CustomerFinancialAdjustmentTransferService {
  private readonly logger = new Logger(CustomerFinancialAdjustmentTransferService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheInvalidationService,
    private readonly permissions: PermissionService,
  ) {}

  // ── Preview ────────────────────────────────────────────────────────────────

  /**
   * Pure read that feeds the transfer dialog: the source's live balance (and so the
   * most that can be transferred), what would be left behind if the source is deactivated
   * afterwards (pending deliveries, held bottles), and — when a target is named —
   * whether it can receive. Always vendor-scoped; a customer outside the caller's vendor
   * is a 404. The route guard (`transfer`) is the permission check, as for the other reads.
   * With no target, only the source side is assessed.
   */
  async preview(vendorId: string, query: TransferPreviewQueryDto) {
    const { fromCustomerId, toCustomerId } = query;
    const customers = await this.prisma.customer.findMany({
      where: { vendorId, id: { in: toCustomerId ? [fromCustomerId, toCustomerId] : [fromCustomerId] } },
      select: CUSTOMER_SELECT,
    });
    const source = customers.find((c) => c.id === fromCustomerId);
    if (!source) throw new NotFoundException('Source customer not found');
    const target = toCustomerId ? customers.find((c) => c.id === toCustomerId) : undefined;
    if (toCustomerId && !target) throw new NotFoundException('Target customer not found');

    const [pendingDeliveryCount, wallets] = await Promise.all([
      this.prisma.dailySheetItem.count({
        where: {
          customerId: fromCustomerId,
          status: DeliveryStatus.PENDING,
          dailySheet: { isClosed: false },
        },
      }),
      this.prisma.bottleWallet.findMany({
        where: { customerId: fromCustomerId, balance: { not: 0 } },
        select: { balance: true, product: { select: { name: true } } },
      }),
    ]);

    const owed = Math.max(0, round2(source.financialBalance));
    const blockers: TransferPreviewBlocker[] = [];
    if (toCustomerId === fromCustomerId) {
      blockers.push({ code: 'SAME_CUSTOMER', message: 'Source and target must be different customers.' });
    }
    if (owed <= 0) {
      blockers.push({
        code: 'SOURCE_HAS_NO_BALANCE',
        message: 'This customer owes nothing, so there is no balance to transfer.',
      });
    }
    if (target && !target.isActive) {
      blockers.push({
        code: 'TARGET_INACTIVE',
        message: 'The target customer is inactive. Reactivate it or choose another customer.',
      });
    }

    return {
      source: {
        ...source,
        /** The most that can be transferred right now ("transfer full balance"). */
        transferableAmount: owed,
        pendingDeliveryCount,
        /** Bottles the customer physically holds (positive wallet balances). */
        heldBottleCount: wallets.reduce((n, w) => n + Math.max(0, w.balance), 0),
        heldBottles: wallets.map((w) => ({ product: w.product.name, balance: w.balance })),
      },
      target: target ?? null,
      canTransfer: blockers.length === 0,
      blockers,
    };
  }

  // ── Create ─────────────────────────────────────────────────────────────────

  async create(user: AuthUser, dto: CreateBalanceTransferDto): Promise<CreateTransferResult> {
    const { vendorId } = user;

    // ── 1. Permission — before any read, so a caller without the right can't probe customers.
    if (!(await this.permissions.can(user.userId, TRANSFER_PERMISSION))) {
      throw new ForbiddenException('You do not have permission to transfer balances.');
    }

    // ── 2. Pure validation (no DB) ───────────────────────────────────────────
    if (dto.fromCustomerId === dto.toCustomerId) {
      throw new BadRequestException('Source and target must be different customers.');
    }
    const amount = normalizeAdjustmentAmount(dto.amount);
    const internalNote = dto.internalNote?.trim() || undefined;
    const referenceNo = dto.referenceNo?.trim() || undefined;
    const idempotencyKey = (dto.idempotencyKey ?? '').trim();
    if (!idempotencyKey) throw new BadRequestException('An idempotency key is required.');

    const fingerprint = { fromCustomerId: dto.fromCustomerId, toCustomerId: dto.toCustomerId, amount };

    // ── 3. Idempotency: a retry returns the original result ──────────────────
    const prior = await this.findGroupByIdempotencyKey(vendorId, idempotencyKey);
    if (prior) return this.replay(prior, fingerprint);

    // ── 4. Both customers must belong to this vendor; state pre-checks ───────
    const customers = await this.prisma.customer.findMany({
      where: { vendorId, id: { in: [dto.fromCustomerId, dto.toCustomerId] } },
      select: CUSTOMER_SELECT,
    });
    const source = customers.find((c) => c.id === dto.fromCustomerId);
    const target = customers.find((c) => c.id === dto.toCustomerId);
    if (!source) throw new NotFoundException('Source customer not found');
    if (!target) throw new NotFoundException('Target customer not found');

    // The SOURCE may be inactive (transfer the balance, then deactivate). The TARGET may not.
    if (!target.isActive) {
      throw new BadRequestException(
        `${target.customerCode} is inactive and cannot receive a balance. Reactivate it or choose another customer.`,
      );
    }
    const owed = Math.max(0, round2(source.financialBalance));
    if (owed <= 0) {
      throw new BadRequestException(
        `${source.customerCode} owes nothing, so there is no balance to transfer.`,
      );
    }
    if (amount > owed) {
      throw new BadRequestException(
        `Cannot transfer ${amount.toFixed(2)}: ${source.customerCode} currently owes ${owed.toFixed(2)}.`,
      );
    }

    const effectiveDate = new Date(); // a transfer is always dated now
    const outTitle = transferOutTitle(target.customerCode);
    const inTitle = transferInTitle(source.customerCode);
    const outDirection = transferLegDirection('TRANSFER_OUT');
    const inDirection = transferLegDirection('TRANSFER_IN');
    const outSigned = signedAdjustmentAmount(outDirection, amount);
    const inSigned = signedAdjustmentAmount(inDirection, amount);

    // ── 5. The atomic unit ───────────────────────────────────────────────────
    let created: Omit<CreateTransferResult, 'idempotentReplay'>;
    try {
      created = await this.prisma.$transaction(async (tx) => {
        // The group first: a racing duplicate submit hits the unique
        // (vendorId, idempotencyKey) HERE, before any balance has been touched.
        const group = await tx.customerFinancialAdjustmentGroup.create({
          data: { vendorId, type: 'TRANSFER', createdById: user.userId, idempotencyKey },
        });

        // Balances, in sorted-id order (deadlock-free — see the class doc).
        for (const id of customerLockOrder(source.id, target.id)) {
          if (id === source.id) {
            const moved = await tx.customer.updateMany({
              where: { id, vendorId, financialBalance: { gte: amount - TRANSFER_BALANCE_EPSILON } },
              data: { financialBalance: { decrement: amount } },
            });
            if (moved.count === 0) {
              throw new ConflictException(
                'The source customer’s balance changed while the transfer was being posted. Nothing was moved — refresh and try again.',
              );
            }
          } else {
            const moved = await tx.customer.updateMany({
              where: { id, vendorId, isActive: true },
              data: { financialBalance: { increment: amount } },
            });
            if (moved.count === 0) {
              throw new ConflictException(
                'The target customer is no longer active. Nothing was moved.',
              );
            }
          }
        }
        // Read back inside the transaction (we hold both row locks, so this is exact).
        const after = await tx.customer.findMany({
          where: { vendorId, id: { in: [source.id, target.id] } },
          select: { id: true, financialBalance: true },
        });
        const sourceAfter = after.find((c) => c.id === source.id)?.financialBalance;
        const targetAfter = after.find((c) => c.id === target.id)?.financialBalance;
        if (sourceAfter === undefined || targetAfter === undefined) {
          throw new ConflictException('A customer disappeared during the transfer. Nothing was moved.');
        }

        // The two documents — linked by the group and pointing at each other's customer.
        const legData = {
          vendorId,
          amount,
          effectiveDate,
          internalNote,
          referenceNo,
          customerVisibility: 'ITEMIZED' as const,
          createdById: user.userId,
          groupId: group.id,
        };
        const sourceAdjustment = await tx.customerFinancialAdjustment.create({
          data: {
            ...legData,
            customerId: source.id,
            counterpartyCustomerId: target.id,
            kind: 'TRANSFER_OUT',
            direction: outDirection,
            title: outTitle,
          },
        });
        const targetAdjustment = await tx.customerFinancialAdjustment.create({
          data: {
            ...legData,
            customerId: target.id,
            counterpartyCustomerId: source.id,
            kind: 'TRANSFER_IN',
            direction: inDirection,
            title: inTitle,
          },
        });

        // The two ledger rows: signed, customer-safe text (the portal returns raw rows),
        // money-only (no productId / bottleCount).
        const sourceTransaction = await tx.transaction.create({
          data: {
            type: TransactionType.ADJUSTMENT,
            vendorId,
            customerId: source.id,
            adjustmentId: sourceAdjustment.id,
            amount: outSigned,
            description: outTitle,
            createdAt: effectiveDate,
          },
        });
        const targetTransaction = await tx.transaction.create({
          data: {
            type: TransactionType.ADJUSTMENT,
            vendorId,
            customerId: target.id,
            adjustmentId: targetAdjustment.id,
            amount: inSigned,
            description: inTitle,
            createdAt: effectiveDate,
          },
        });

        // THE invariant: the legs net to zero. Thrown in-tx → the whole transfer rolls back.
        assertLegsNetZero([sourceTransaction.amount ?? NaN, targetTransaction.amount ?? NaN]);

        // Audit: the group, plus each leg (so every document's own history is non-empty).
        await tx.auditLog.create({
          data: {
            vendorId,
            userId: user.userId,
            userName: user.name,
            action: 'CREATE',
            entity: 'CustomerFinancialAdjustmentGroup',
            entityId: group.id,
            changes: {
              after: {
                type: 'TRANSFER',
                amount,
                fromCustomerId: source.id,
                toCustomerId: target.id,
                sourceLegId: sourceAdjustment.id,
                targetLegId: targetAdjustment.id,
                sourceTransactionId: sourceTransaction.id,
                targetTransactionId: targetTransaction.id,
                referenceNo: referenceNo ?? null,
                sourceBalance: { before: round2(sourceAfter + amount), after: sourceAfter },
                targetBalance: { before: round2(targetAfter - amount), after: targetAfter },
              },
              ...(internalNote ? { reason: internalNote } : {}),
            } as Prisma.InputJsonValue,
          },
        });
        for (const leg of [
          { adjustment: sourceAdjustment, transaction: sourceTransaction, signed: outSigned, balance: sourceAfter },
          { adjustment: targetAdjustment, transaction: targetTransaction, signed: inSigned, balance: targetAfter },
        ]) {
          await tx.auditLog.create({
            data: {
              vendorId,
              userId: user.userId,
              userName: user.name,
              action: 'CREATE',
              entity: 'CustomerFinancialAdjustment',
              entityId: leg.adjustment.id,
              changes: {
                before: { financialBalance: round2(leg.balance - leg.signed) },
                after: {
                  kind: leg.adjustment.kind,
                  direction: leg.adjustment.direction,
                  amount,
                  signedAmount: leg.signed,
                  groupId: group.id,
                  counterpartyCustomerId: leg.adjustment.counterpartyCustomerId,
                  transactionId: leg.transaction.id,
                  financialBalance: leg.balance,
                },
                ...(internalNote ? { reason: internalNote } : {}),
              } as Prisma.InputJsonValue,
            },
          });
        }

        return {
          group,
          sourceLeg: { adjustment: sourceAdjustment, transaction: sourceTransaction },
          targetLeg: { adjustment: targetAdjustment, transaction: targetTransaction },
          sourceBalance: sourceAfter,
          targetBalance: targetAfter,
        };
      });
    } catch (err) {
      // Two identical submits racing: both passed the lookup, one's group insert hit the
      // unique (vendorId, idempotencyKey) before touching any balance. The loser replays.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const winner = await this.findGroupByIdempotencyKey(vendorId, idempotencyKey);
        if (winner) return this.replay(winner, fingerprint);
      }
      throw err;
    }

    await this.invalidateCaches(vendorId, [source.id, target.id]);
    return { ...created, idempotentReplay: false };
  }

  // ── Void ───────────────────────────────────────────────────────────────────

  /**
   * Voids a POSTED transfer by reversing BOTH legs — nothing is edited or deleted, so
   * the ledger stays append-only and each leg's chain is traceable
   * (`reversal.reversalOfId` → leg; leg `status = VOIDED`; group `status = VOIDED`).
   *
   * ONE database transaction:
   *   1. CLAIM the group (`updateMany where status = POSTED` → VOIDED) — FIRST, and the
   *      concurrency-safe double-void guard: a racing second void matches 0 rows, throws
   *      409 and rolls back. Then claim each leg the same way.
   *   2. move both balances by the exact negation of each leg's ledger amount, in
   *      sorted-id order (source is charged back, target is credited back);
   *   3. create the two REVERSAL documents + their ledger rows (dated the ACTUAL void
   *      moment, exact negation of the leg's ledger amount, customer-safe text),
   *   4. assert the reversal rows net to zero,
   *   5. audit: VOID on the group and on each leg, CREATE on each reversal.
   * The original ledger rows are never touched. Reversals carry no `groupId`, so the
   * group stays exactly two documents.
   *
   * Permission: BOTH `void` and `transfer` (checked here as well as on the route) —
   * voiding a transfer reduces one customer's balance and increases another's.
   */
  async voidTransfer(
    user: AuthUser,
    groupId: string,
    dto: VoidCustomerFinancialAdjustmentDto,
  ): Promise<VoidTransferResult> {
    const { vendorId } = user;

    // ── 1. Permission — before any read ──────────────────────────────────────
    const [canVoid, canTransfer] = await Promise.all([
      this.permissions.can(user.userId, VOID_PERMISSION),
      this.permissions.can(user.userId, TRANSFER_PERMISSION),
    ]);
    if (!canVoid || !canTransfer) {
      throw new ForbiddenException(
        'Voiding a balance transfer needs both the void and the transfer permissions.',
      );
    }

    // ── 2. Reason ────────────────────────────────────────────────────────────
    const reason = (dto.reason ?? '').trim();
    if (reason.length < VOID_REASON_MIN_LENGTH) {
      throw new BadRequestException(
        `A reason of at least ${VOID_REASON_MIN_LENGTH} characters is required to void a transfer.`,
      );
    }

    // ── 3. Load (vendor-scoped) + guards ─────────────────────────────────────
    const group = await this.prisma.customerFinancialAdjustmentGroup.findFirst({
      where: { id: groupId, vendorId },
      include: GROUP_WITH_LEGS,
    });
    if (!group) throw new NotFoundException('Transfer not found');
    if (group.status === 'VOIDED') {
      throw new ConflictException('This transfer has already been voided.');
    }
    const { sourceLeg, targetLeg } = this.resolveLegs(group);
    if (sourceLeg.adjustment.status !== 'POSTED' || targetLeg.adjustment.status !== 'POSTED') {
      throw new ConflictException('This transfer is in an inconsistent state. Contact support.');
    }

    // ── 4. What the reversals look like ──────────────────────────────────────
    const voidedAt = new Date(); // the ACTUAL void moment — the reversals' business date
    const legs = [
      { leg: sourceLeg, reversalAmount: -(sourceLeg.transaction.amount as number) },
      { leg: targetLeg, reversalAmount: -(targetLeg.transaction.amount as number) },
    ];

    // ── 5. The atomic unit ───────────────────────────────────────────────────
    let done: VoidTransferResult;
    try {
      done = await this.prisma.$transaction(async (tx) => {
        // (1) Claim the group FIRST, then each leg — see the doc above.
        const claimedGroup = await tx.customerFinancialAdjustmentGroup.updateMany({
          where: { id: group.id, vendorId, status: 'POSTED' },
          data: { status: 'VOIDED', voidedById: user.userId, voidedAt, voidReason: reason },
        });
        if (claimedGroup.count === 0) {
          throw new ConflictException('This transfer has already been voided.');
        }
        for (const { leg } of legs) {
          const claimed = await tx.customerFinancialAdjustment.updateMany({
            where: { id: leg.adjustment.id, vendorId, groupId: group.id, status: 'POSTED' },
            data: { status: 'VOIDED', voidedById: user.userId, voidedAt, voidReason: reason },
          });
          if (claimed.count === 0) {
            throw new ConflictException('This transfer has already been voided.');
          }
        }

        // (2) Balances — sorted-id order. `update` returns the row-locked new balance.
        const balanceAfter = new Map<string, number>();
        for (const id of customerLockOrder(
          sourceLeg.adjustment.customerId,
          targetLeg.adjustment.customerId,
        )) {
          const { reversalAmount } = legs.find(({ leg }) => leg.adjustment.customerId === id) as (typeof legs)[number];
          const updated = await tx.customer.update({
            where: { id },
            data: { financialBalance: { increment: reversalAmount } },
            select: { financialBalance: true },
          });
          balanceAfter.set(id, updated.financialBalance);
        }

        // (3) The two reversals + their ledger rows.
        const reversals: TransferLeg[] = [];
        for (const { leg, reversalAmount } of legs) {
          const original = leg.adjustment;
          const reversal = await tx.customerFinancialAdjustment.create({
            data: {
              vendorId,
              customerId: original.customerId,
              kind: 'REVERSAL',
              direction: oppositeAdjustmentDirection(original.direction),
              amount: original.amount,
              effectiveDate: voidedAt,
              title: `Reversal: ${original.title}`,
              internalNote: reason,
              customerVisibility: original.customerVisibility,
              createdById: user.userId,
              reversalOfId: original.id,
              counterpartyCustomerId: original.counterpartyCustomerId,
            },
          });
          const transaction = await tx.transaction.create({
            data: {
              type: TransactionType.ADJUSTMENT,
              vendorId,
              customerId: original.customerId,
              adjustmentId: reversal.id,
              amount: reversalAmount,
              description: customerFacingReversalText(original.customerVisibility, original.title),
              createdAt: voidedAt,
            },
          });
          reversals.push({ adjustment: reversal, transaction });
        }
        const [sourceReversal, targetReversal] = reversals;

        // (4) The invariant, on the reversal side.
        assertLegsNetZero(reversals.map((r) => r.transaction.amount ?? NaN));

        // (5) Audit — the group, each leg, each reversal.
        const sourceBalance = balanceAfter.get(sourceLeg.adjustment.customerId) as number;
        const targetBalance = balanceAfter.get(targetLeg.adjustment.customerId) as number;
        await tx.auditLog.create({
          data: {
            vendorId,
            userId: user.userId,
            userName: user.name,
            action: 'VOID',
            entity: 'CustomerFinancialAdjustmentGroup',
            entityId: group.id,
            changes: {
              before: { status: 'POSTED' },
              after: {
                status: 'VOIDED',
                voidedAt: voidedAt.toISOString(),
                sourceLegId: sourceLeg.adjustment.id,
                targetLegId: targetLeg.adjustment.id,
                sourceReversalId: sourceReversal.adjustment.id,
                targetReversalId: targetReversal.adjustment.id,
                sourceBalance,
                targetBalance,
              },
              reason,
            } as Prisma.InputJsonValue,
          },
        });
        for (let i = 0; i < legs.length; i++) {
          const { leg, reversalAmount } = legs[i];
          const reversal = reversals[i];
          const balance = balanceAfter.get(leg.adjustment.customerId) as number;
          await tx.auditLog.create({
            data: {
              vendorId,
              userId: user.userId,
              userName: user.name,
              action: 'VOID',
              entity: 'CustomerFinancialAdjustment',
              entityId: leg.adjustment.id,
              changes: {
                before: { status: 'POSTED', financialBalance: round2(balance - reversalAmount) },
                after: {
                  status: 'VOIDED',
                  voidedAt: voidedAt.toISOString(),
                  groupId: group.id,
                  reversalId: reversal.adjustment.id,
                  reversalTransactionId: reversal.transaction.id,
                  reversalSignedAmount: reversalAmount,
                  financialBalance: balance,
                },
                reason,
              } as Prisma.InputJsonValue,
            },
          });
          await tx.auditLog.create({
            data: {
              vendorId,
              userId: user.userId,
              userName: user.name,
              action: 'CREATE',
              entity: 'CustomerFinancialAdjustment',
              entityId: reversal.adjustment.id,
              changes: {
                after: {
                  kind: 'REVERSAL',
                  direction: reversal.adjustment.direction,
                  amount: leg.adjustment.amount,
                  signedAmount: reversalAmount,
                  reversalOfId: leg.adjustment.id,
                  effectiveDate: voidedAt.toISOString(),
                  transactionId: reversal.transaction.id,
                },
                reason,
              } as Prisma.InputJsonValue,
            },
          });
        }

        return {
          group: await tx.customerFinancialAdjustmentGroup.findUniqueOrThrow({ where: { id: group.id } }),
          voidedSourceLeg: await tx.customerFinancialAdjustment.findUniqueOrThrow({
            where: { id: sourceLeg.adjustment.id },
          }),
          voidedTargetLeg: await tx.customerFinancialAdjustment.findUniqueOrThrow({
            where: { id: targetLeg.adjustment.id },
          }),
          sourceReversal,
          targetReversal,
          sourceBalance,
          targetBalance,
        };
      });
    } catch (err) {
      // reversalOfId is @unique: a second reversal of a leg is impossible at the DB level.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('This transfer has already been voided.');
      }
      throw err;
    }

    await this.invalidateCaches(vendorId, [
      sourceLeg.adjustment.customerId,
      targetLeg.adjustment.customerId,
    ]);
    return done;
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private findGroupByIdempotencyKey(vendorId: string, idempotencyKey: string) {
    return this.prisma.customerFinancialAdjustmentGroup.findFirst({
      where: { vendorId, idempotencyKey },
      include: GROUP_WITH_LEGS,
    });
  }

  /**
   * A group is exactly one TRANSFER_OUT + one TRANSFER_IN of the same amount between two
   * different customers who name each other as counterparty, each with its ledger row
   * carrying the signed amount its document implies. Anything else is corruption: fail
   * loudly rather than reverse or replay data that does not add up.
   */
  private resolveLegs(group: LoadedGroup): { sourceLeg: TransferLeg; targetLeg: TransferLeg } {
    const out = group.adjustments.find((a) => a.kind === 'TRANSFER_OUT');
    const inn = group.adjustments.find((a) => a.kind === 'TRANSFER_IN');
    const outTxn = out?.transaction;
    const inTxn = inn?.transaction;
    const consistent =
      group.adjustments.length === 2 &&
      out &&
      inn &&
      outTxn &&
      inTxn &&
      outTxn.amount !== null &&
      inTxn.amount !== null &&
      out.amount === inn.amount &&
      out.customerId !== inn.customerId &&
      out.counterpartyCustomerId === inn.customerId &&
      inn.counterpartyCustomerId === out.customerId &&
      round2(outTxn.amount) === round2(signedAdjustmentAmount(out.direction, out.amount)) &&
      round2(inTxn.amount) === round2(signedAdjustmentAmount(inn.direction, inn.amount));
    if (!consistent) {
      throw new ConflictException('This transfer’s records are inconsistent. Contact support.');
    }
    return {
      sourceLeg: { adjustment: out, transaction: outTxn },
      targetLeg: { adjustment: inn, transaction: inTxn },
    };
  }

  /**
   * Same key + same request → hand back the original outcome (nothing is posted).
   * Same key + a DIFFERENT request → 409 (the client reused a key, which would otherwise
   * silently drop the second, different transfer).
   */
  private async replay(
    prior: LoadedGroup,
    fingerprint: { fromCustomerId: string; toCustomerId: string; amount: number },
  ): Promise<CreateTransferResult> {
    const { sourceLeg, targetLeg } = this.resolveLegs(prior);
    const same =
      sourceLeg.adjustment.customerId === fingerprint.fromCustomerId &&
      targetLeg.adjustment.customerId === fingerprint.toCustomerId &&
      sourceLeg.adjustment.amount === fingerprint.amount;
    if (!same) {
      throw new ConflictException(
        'This idempotency key was already used for a different transfer. Use a new key.',
      );
    }
    // The group row itself, as a fresh create returns it (the legs are returned separately).
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { adjustments: _legs, ...group } = prior;
    const live = await this.prisma.customer.findMany({
      where: { vendorId: prior.vendorId, id: { in: [fingerprint.fromCustomerId, fingerprint.toCustomerId] } },
      select: { id: true, financialBalance: true },
    });
    return {
      group,
      sourceLeg,
      targetLeg,
      sourceBalance: live.find((c) => c.id === fingerprint.fromCustomerId)?.financialBalance ?? 0,
      targetBalance: live.find((c) => c.id === fingerprint.toCustomerId)?.financialBalance ?? 0,
      idempotentReplay: true,
    };
  }

  /**
   * Same fan-out as CustomerFinancialAdjustmentService (customers list, overview cards,
   * analytics, wallet cache per customer) — AFTER commit, never fatal: the money is
   * already moved, a Redis hiccup must not turn it into a 500.
   */
  private async invalidateCaches(vendorId: string, customerIds: string[]): Promise<void> {
    try {
      await Promise.all([
        this.cache.invalidateVendorEntity(vendorId, CACHE_KEYS.CUSTOMERS),
        this.cache.invalidateOverview(vendorId),
        this.cache.invalidateAnalytics(vendorId),
        ...customerIds.map((id) => this.cache.invalidateCustomerWallets(vendorId, id)),
      ]);
    } catch (e) {
      this.logger.warn(
        `Cache invalidation failed after a balance transfer (${customerIds.join(', ')}): ${(e as Error).message}`,
      );
    }
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;
