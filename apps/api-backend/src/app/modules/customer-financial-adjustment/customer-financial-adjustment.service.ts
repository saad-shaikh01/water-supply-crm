import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  TransactionType,
  type CustomerFinancialAdjustment,
  type Transaction,
} from '@prisma/client';
import { PrismaService } from '@water-supply-crm/database';
import { CacheInvalidationService, CACHE_KEYS } from '@water-supply-crm/caching';
import {
  ADJUSTMENT_KIND_POLICY,
  adjustmentKindPermission,
  type AdjustmentDirection,
  type AdjustmentVisibility,
  type AuthUser,
} from '@water-supply-crm/types';
import { PermissionService } from '../authz/permission.service';
import { paginate } from '../../common/helpers/paginate';
import { vendorDayEnd, vendorDayStart } from '../../common/helpers/date.util';
import { ListCustomerFinancialAdjustmentsQueryDto } from './dto/list-customer-financial-adjustments-query.dto';
import { CreateCustomerFinancialAdjustmentDto } from './dto/create-customer-financial-adjustment.dto';
import {
  VOID_REASON_MIN_LENGTH,
  VoidCustomerFinancialAdjustmentDto,
} from './dto/void-customer-financial-adjustment.dto';
import {
  POSTABLE_ADJUSTMENT_KINDS,
  customerFacingAdjustmentText,
  customerFacingReversalText,
  normalizeAdjustmentAmount,
  oppositeAdjustmentDirection,
  resolveAdjustmentDirection,
  resolveAdjustmentEffectiveDate,
  signedAdjustmentAmount,
} from './adjustment-posting.util';

/**
 * What the read endpoints return with each adjustment. STAFF-facing (gated by
 * `customer_financial_adjustments:view`, which Viewer and field roles do not hold), so the
 * staff-only `internalNote` is included. `reversalOf` / `reversedBy` are the two ends of
 * the void chain: a REVERSAL carries `reversalOf` (the original it cancels), a voided
 * original carries `reversedBy` (its reversal). `transaction` is the single ledger row
 * (signed amount) the adjustment posted.
 */
const ADJUSTMENT_READ_INCLUDE = {
  customer: { select: { id: true, name: true, customerCode: true } },
  createdBy: { select: { id: true, name: true } },
  voidedBy: { select: { id: true, name: true } },
  reversalOf: { select: { id: true, kind: true, title: true, status: true, effectiveDate: true } },
  reversedBy: { select: { id: true, kind: true, status: true, effectiveDate: true } },
  transaction: { select: { id: true, amount: true, description: true, createdAt: true } },
} satisfies Prisma.CustomerFinancialAdjustmentInclude;

/** RBAC permission that authorizes voiding (a static string — checked in the service, see voidAdjustment). */
const VOID_PERMISSION = 'customer_financial_adjustments:void' as const;

export interface VoidAdjustmentResult {
  /** The ORIGINAL adjustment, now VOIDED (with voidedBy / voidedAt / voidReason). */
  adjustment: CustomerFinancialAdjustment;
  /** The REVERSAL document (`reversalOfId` → the original). */
  reversal: CustomerFinancialAdjustment;
  /** The reversal's ledger row: the exact opposite of the original's, dated the void moment. */
  reversalTransaction: Transaction;
  /** The customer's `financialBalance` right after the void. */
  customerBalance: number;
}

export interface CreateAdjustmentResult {
  adjustment: CustomerFinancialAdjustment;
  /** The single ADJUSTMENT ledger row this adjustment posted (signed amount). */
  transaction: Transaction;
  /**
   * The customer's `financialBalance` — right after this post on a fresh create,
   * or the LIVE balance now when `idempotentReplay` is true.
   */
  customerBalance: number;
  /** True when this key was already used with the same request: nothing new was posted. */
  idempotentReplay: boolean;
}

/**
 * Customer Financial Adjustments — Phase 2A: the posting engine (owner-approved
 * 2026-09-21). One method, `create`, is the ONLY writer of adjustment ledger rows.
 *
 * LEDGER-FIRST. The statement's opening/closing balances are back-derived from
 * Transaction sums, so an adjustment is never a side table: posting writes, in ONE
 * database transaction,
 *   1. the CustomerFinancialAdjustment document,
 *   2. the single ADJUSTMENT `Transaction` row (signed; linked by adjustmentId),
 *   3. the `Customer.financialBalance` increment,
 *   4. the audit-log row,
 * so all four succeed or none do. (The audit row is written with `tx.auditLog`, not
 * AuditService — that one uses the plain client and swallows its own errors, so it
 * cannot be part of an atomic unit.)
 *
 * Mirrors the ledger's own recordPayment pattern (increment + Transaction row) but
 * deliberately does NOT reuse or modify LedgerService: its methods each own their
 * transaction, carry different semantics, and the existing financial flows stay
 * untouched. Cache invalidation happens AFTER commit (recordPayment does it inside
 * the transaction, where a concurrent reader can repopulate a stale entry before
 * the commit lands).
 *
 * Slice scope: 2A `create` (charge and credit kinds) + 2B `voidAdjustment`
 * (immutable void by reversal) + 2C `list` / `get` (staff reads) + 2D write-off and
 * correction kinds through the same `create`. Transfers arrive in a later slice.
 */
@Injectable()
export class CustomerFinancialAdjustmentService {
  private readonly logger = new Logger(CustomerFinancialAdjustmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheInvalidationService,
    private readonly permissions: PermissionService,
  ) {}

  async create(
    user: AuthUser,
    dto: CreateCustomerFinancialAdjustmentDto,
  ): Promise<CreateAdjustmentResult> {
    const { vendorId } = user;

    // ── 1. Slice gate + policy ───────────────────────────────────────────────
    if (!(POSTABLE_ADJUSTMENT_KINDS as readonly string[]).includes(dto.kind)) {
      throw new BadRequestException(`Adjustment kind ${dto.kind} cannot be posted yet.`);
    }
    const policy = ADJUSTMENT_KIND_POLICY[dto.kind];
    // Visibility is resolved from the kind (never per document). Only REVERSAL derives it,
    // and a reversal is created by void, never here — this also narrows the type.
    if (policy.visibility === 'DERIVED') {
      throw new BadRequestException(`Adjustment kind ${dto.kind} cannot be posted yet.`);
    }
    const visibility: AdjustmentVisibility = policy.visibility;
    // Fixed by the kind — except CORRECTION, where the caller must choose (and a
    // conflicting value on a fixed kind is a 400, never silently ignored).
    const direction: AdjustmentDirection = resolveAdjustmentDirection(policy.direction, dto.direction);

    // ── 2. Per-kind permission (the route guard is only the coarse "any of") ──
    // Checked BEFORE any read so a caller without the right can't probe customers.
    const required = adjustmentKindPermission(dto.kind);
    if (!required || !(await this.permissions.can(user.userId, required))) {
      throw new ForbiddenException('You do not have permission to post this type of adjustment.');
    }

    // ── 3. Pure validation (no DB) ───────────────────────────────────────────
    const amount = normalizeAdjustmentAmount(dto.amount);
    const title = (dto.title ?? '').trim();
    if (!title) throw new BadRequestException('Title is required.');
    const internalNote = dto.internalNote?.trim() || undefined;
    const referenceNo = dto.referenceNo?.trim() || undefined;
    if (policy.requiresInternalNote && !internalNote) {
      throw new BadRequestException(
        'An internal note is required — record why this customer’s balance is being reduced.',
      );
    }
    const effectiveDate = resolveAdjustmentEffectiveDate(dto.effectiveDate);
    const idempotencyKey = (dto.idempotencyKey ?? '').trim();
    if (!idempotencyKey) throw new BadRequestException('An idempotency key is required.');

    const fingerprint = { customerId: dto.customerId, kind: dto.kind, direction, amount, title };

    // ── 4. Idempotency: a retry returns the original result ──────────────────
    const prior = await this.findByIdempotencyKey(vendorId, idempotencyKey);
    if (prior) return this.replay(prior, fingerprint);

    // ── 5. Customer must belong to this vendor ───────────────────────────────
    const customer = await this.prisma.customer.findFirst({
      where: { id: dto.customerId, vendorId },
      select: { id: true },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    const signed = signedAdjustmentAmount(direction, amount);
    const ledgerText = customerFacingAdjustmentText(visibility, title);

    // ── 6. The atomic unit ───────────────────────────────────────────────────
    let created: Omit<CreateAdjustmentResult, 'idempotentReplay'>;
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const adjustment = await tx.customerFinancialAdjustment.create({
          data: {
            vendorId,
            customerId: dto.customerId,
            kind: dto.kind,
            direction,
            amount,
            effectiveDate,
            title,
            internalNote,
            referenceNo,
            customerVisibility: visibility,
            createdById: user.userId,
            idempotencyKey,
          },
        });

        // The ledger row: signed, customer-safe text ONLY (the portal returns raw
        // Transaction rows — title/internalNote never go here unless ITEMIZED),
        // createdAt = business date (the ledger's createdAt IS the business date).
        // No productId / bottleCount: money-only, so bottle-wallet math is untouched.
        const transaction = await tx.transaction.create({
          data: {
            type: TransactionType.ADJUSTMENT,
            vendorId,
            customerId: dto.customerId,
            adjustmentId: adjustment.id,
            amount: signed,
            description: ledgerText,
            createdAt: effectiveDate,
          },
        });

        const updated = await tx.customer.update({
          where: { id: dto.customerId },
          data: { financialBalance: { increment: signed } },
          select: { financialBalance: true },
        });

        // A write-off can only write off what is OWED. Checked on the balance the update
        // just returned (row-locked, so race-safe) and thrown INSIDE the transaction so
        // the whole post rolls back: writing off more than the customer owes would hand
        // them free credit while reporting it as a company loss.
        if (dto.kind === 'WRITE_OFF' && round2(updated.financialBalance) < 0) {
          const owed = Math.max(0, round2(updated.financialBalance + amount));
          throw new BadRequestException(
            owed > 0
              ? `A write-off cannot exceed what the customer owes (outstanding: ${owed.toFixed(2)}).`
              : 'This customer owes nothing, so there is nothing to write off.',
          );
        }

        await tx.auditLog.create({
          data: {
            vendorId,
            userId: user.userId,
            userName: user.name,
            action: 'CREATE',
            entity: 'CustomerFinancialAdjustment',
            entityId: adjustment.id,
            changes: {
              before: { financialBalance: round2(updated.financialBalance - signed) },
              after: {
                customerId: dto.customerId,
                kind: dto.kind,
                direction,
                amount,
                signedAmount: signed,
                effectiveDate: effectiveDate.toISOString(),
                title,
                referenceNo: referenceNo ?? null,
                customerVisibility: visibility,
                transactionId: transaction.id,
                financialBalance: updated.financialBalance,
              },
              ...(internalNote ? { reason: internalNote } : {}),
            } as Prisma.InputJsonValue,
          },
        });

        return { adjustment, transaction, customerBalance: updated.financialBalance };
      });
    } catch (err) {
      // Two identical submits racing: both passed the lookup above, one's insert hit
      // the unique (vendorId, idempotencyKey). The loser replays the winner.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const winner = await this.findByIdempotencyKey(vendorId, idempotencyKey);
        if (winner) return this.replay(winner, fingerprint);
      }
      throw err;
    }

    await this.invalidateCaches(vendorId, dto.customerId);
    return { ...created, idempotentReplay: false };
  }

  /**
   * Staff read: a page of adjustments, newest business date first. ALWAYS scoped to the
   * caller's vendor. Permission (`customer_financial_adjustments:view`) is enforced by
   * the route guard — this is a pure read with no other caller, so unlike `voidAdjustment`
   * it does not re-check.
   */
  async list(vendorId: string, query: ListCustomerFinancialAdjustmentsQueryDto) {
    const { page = 1, limit = 20, customerId, kind, status, dateFrom, dateTo } = query;

    // Business-date range by the vendor's calendar day (Asia/Karachi), not the server's.
    const effectiveDate =
      dateFrom || dateTo
        ? {
            ...(dateFrom && { gte: vendorDayStart(dateFrom) }),
            ...(dateTo && { lte: vendorDayEnd(dateTo) }),
          }
        : undefined;

    const where: Prisma.CustomerFinancialAdjustmentWhereInput = {
      vendorId,
      ...(customerId && { customerId }),
      ...(kind && { kind }),
      ...(status && { status }),
      ...(effectiveDate && { effectiveDate }),
    };

    const [data, total] = await Promise.all([
      this.prisma.customerFinancialAdjustment.findMany({
        where,
        include: ADJUSTMENT_READ_INCLUDE,
        // createdAt breaks ties so same-day entries keep their posting order.
        orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.customerFinancialAdjustment.count({ where }),
    ]);

    return paginate(data, total, page, limit);
  }

  /** Staff read: one adjustment with its void chain and ledger row. 404 outside the caller's vendor. */
  async get(vendorId: string, id: string) {
    const adjustment = await this.prisma.customerFinancialAdjustment.findFirst({
      where: { id, vendorId },
      include: ADJUSTMENT_READ_INCLUDE,
    });
    if (!adjustment) throw new NotFoundException('Adjustment not found');
    return adjustment;
  }

  /**
   * Voids a POSTED adjustment by posting its REVERSAL — nothing is edited or deleted,
   * so the ledger stays append-only and the whole chain is traceable
   * (`reversal.reversalOfId` → original; `original.status = VOIDED`).
   *
   * ONE database transaction, so all of these succeed or none do:
   *   1. CLAIM the original: `updateMany where status = POSTED` → VOIDED. This is FIRST
   *      and is the concurrency-safe double-void guard: a racing second void waits on
   *      the row lock, then matches 0 rows, throws 409, and its whole transaction
   *      rolls back. (`reversalOfId` is also @unique in the schema — a second reversal
   *      is impossible even if this guard were bypassed.)
   *   2. create the REVERSAL document (opposite direction, same positive amount),
   *   3. create the reversal's ledger row — the EXACT negation of the original's
   *      ledger amount (not recomputed), linked by adjustmentId to the reversal,
   *   4. move `Customer.financialBalance` by that amount,
   *   5. write TWO audit rows: VOID on the original (names the reversal) and CREATE on
   *      the reversal (so its own history is not empty) — via `tx.auditLog`, for the
   *      same reason as `create`.
   * The ORIGINAL ledger row is never touched. The reversal is dated the ACTUAL void
   * moment — even when the original was backdated — so a statement the customer has
   * already received is never rewritten.
   *
   * Refused before any write: a REVERSAL (to undo a void, post a new adjustment), a
   * transfer leg (voided as a whole group, later slice), and any adjustment whose
   * ledger row is missing or disagrees with its document (voiding corrupt data would
   * compound it).
   *
   * Permission: `void` is enforced here as well as on the route, so the service is the
   * enforcement point whoever calls it. `void` alone suffices — it does not also need the
   * original kind's posting permission (Vendor Admin + Accountant only by default).
   */
  async voidAdjustment(
    user: AuthUser,
    adjustmentId: string,
    dto: VoidCustomerFinancialAdjustmentDto,
  ): Promise<VoidAdjustmentResult> {
    const { vendorId } = user;

    // ── 1. Permission — before any read ──────────────────────────────────────
    if (!(await this.permissions.can(user.userId, VOID_PERMISSION))) {
      throw new ForbiddenException('You do not have permission to void adjustments.');
    }

    // ── 2. Reason ────────────────────────────────────────────────────────────
    const reason = (dto.reason ?? '').trim();
    if (reason.length < VOID_REASON_MIN_LENGTH) {
      throw new BadRequestException(
        `A reason of at least ${VOID_REASON_MIN_LENGTH} characters is required to void an adjustment.`,
      );
    }

    // ── 3. Load (vendor-scoped) + guards ─────────────────────────────────────
    const original = await this.prisma.customerFinancialAdjustment.findFirst({
      where: { id: adjustmentId, vendorId },
      include: { transaction: true },
    });
    if (!original) throw new NotFoundException('Adjustment not found');

    if (original.kind === 'REVERSAL') {
      throw new BadRequestException(
        'A reversal cannot be voided. To undo it, post a new adjustment.',
      );
    }
    if (original.status === 'VOIDED') {
      throw new ConflictException('This adjustment has already been voided.');
    }
    if (original.groupId || ADJUSTMENT_KIND_POLICY[original.kind].creation !== 'STANDALONE') {
      throw new BadRequestException(
        'This adjustment is one leg of a balance transfer and cannot be voided on its own.',
      );
    }
    const ledger = original.transaction;
    if (!ledger || ledger.amount === null) {
      // A POSTED adjustment always has its ledger row (same DB transaction as its
      // creation) — a missing one is corruption: fail loudly, never paper over it.
      throw new ConflictException('This adjustment has no ledger entry. Contact support.');
    }
    if (
      round2(ledger.amount) !== round2(signedAdjustmentAmount(original.direction, original.amount))
    ) {
      throw new ConflictException(
        'This adjustment’s ledger entry does not match the adjustment. Contact support.',
      );
    }

    // ── 4. What the reversal looks like ──────────────────────────────────────
    const voidedAt = new Date(); // the ACTUAL void moment — the reversal's business date
    const reversalLedgerAmount = -ledger.amount; // exact negation, never recomputed
    const reversalDirection = oppositeAdjustmentDirection(original.direction);
    const visibility = original.customerVisibility;
    const ledgerText = customerFacingReversalText(visibility, original.title);

    // ── 5. The atomic unit ───────────────────────────────────────────────────
    let done: VoidAdjustmentResult;
    try {
      done = await this.prisma.$transaction(async (tx) => {
        // (1) Claim the original FIRST — see the class doc.
        const claimed = await tx.customerFinancialAdjustment.updateMany({
          where: { id: original.id, vendorId, status: 'POSTED' },
          data: { status: 'VOIDED', voidedById: user.userId, voidedAt, voidReason: reason },
        });
        if (claimed.count === 0) {
          throw new ConflictException('This adjustment has already been voided.');
        }

        // (2) The reversal document. Visibility is copied from the original.
        const reversal = await tx.customerFinancialAdjustment.create({
          data: {
            vendorId,
            customerId: original.customerId,
            kind: 'REVERSAL',
            direction: reversalDirection,
            amount: original.amount,
            effectiveDate: voidedAt,
            title: `Reversal: ${original.title}`,
            internalNote: reason,
            customerVisibility: visibility,
            createdById: user.userId,
            reversalOfId: original.id,
          },
        });

        // (3) The reversal's ledger row. Customer-safe text only; money-only.
        const reversalTransaction = await tx.transaction.create({
          data: {
            type: TransactionType.ADJUSTMENT,
            vendorId,
            customerId: original.customerId,
            adjustmentId: reversal.id,
            amount: reversalLedgerAmount,
            description: ledgerText,
            createdAt: voidedAt,
          },
        });

        // (4) Balance.
        const updated = await tx.customer.update({
          where: { id: original.customerId },
          data: { financialBalance: { increment: reversalLedgerAmount } },
          select: { financialBalance: true },
        });
        const balanceBefore = round2(updated.financialBalance - reversalLedgerAmount);

        // (5) Audit — both ends of the chain.
        await tx.auditLog.create({
          data: {
            vendorId,
            userId: user.userId,
            userName: user.name,
            action: 'VOID',
            entity: 'CustomerFinancialAdjustment',
            entityId: original.id,
            changes: {
              before: { status: 'POSTED', financialBalance: balanceBefore },
              after: {
                status: 'VOIDED',
                voidedAt: voidedAt.toISOString(),
                reversalId: reversal.id,
                reversalTransactionId: reversalTransaction.id,
                reversalSignedAmount: reversalLedgerAmount,
                financialBalance: updated.financialBalance,
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
            entityId: reversal.id,
            changes: {
              after: {
                kind: 'REVERSAL',
                direction: reversalDirection,
                amount: original.amount,
                signedAmount: reversalLedgerAmount,
                reversalOfId: original.id,
                effectiveDate: voidedAt.toISOString(),
                transactionId: reversalTransaction.id,
              },
              reason,
            } as Prisma.InputJsonValue,
          },
        });

        const voided = await tx.customerFinancialAdjustment.findUniqueOrThrow({
          where: { id: original.id },
        });
        return {
          adjustment: voided,
          reversal,
          reversalTransaction,
          customerBalance: updated.financialBalance,
        };
      });
    } catch (err) {
      // The unique reversalOfId is the database-level "reversed at most once" guard.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('This adjustment has already been voided.');
      }
      throw err;
    }

    await this.invalidateCaches(vendorId, original.customerId);
    return done;
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private findByIdempotencyKey(vendorId: string, idempotencyKey: string) {
    return this.prisma.customerFinancialAdjustment.findFirst({
      where: { vendorId, idempotencyKey },
      include: { transaction: true },
    });
  }

  /**
   * Same key + same request → hand back the original outcome (nothing is posted).
   * Same key + a DIFFERENT request → 409: the client reused a key, which would
   * otherwise silently drop the second, different adjustment.
   */
  private async replay(
    prior: CustomerFinancialAdjustment & { transaction: Transaction | null },
    fingerprint: {
      customerId: string;
      kind: string;
      direction: AdjustmentDirection;
      amount: number;
      title: string;
    },
  ): Promise<CreateAdjustmentResult> {
    const same =
      prior.customerId === fingerprint.customerId &&
      prior.kind === fingerprint.kind &&
      prior.direction === fingerprint.direction && // a CORRECTION's direction is caller-chosen
      prior.amount === fingerprint.amount &&
      prior.title === fingerprint.title;
    if (!same) {
      throw new ConflictException(
        'This idempotency key was already used for a different adjustment. Use a new key.',
      );
    }
    if (!prior.transaction) {
      // A POSTED adjustment always has its ledger row (same DB transaction) — a
      // missing one means data corruption; fail loudly rather than mask it.
      throw new ConflictException('Adjustment exists without its ledger row. Contact support.');
    }
    const { transaction, ...adjustment } = prior;
    const customer = await this.prisma.customer.findUnique({
      where: { id: prior.customerId },
      select: { financialBalance: true },
    });
    return {
      adjustment,
      transaction,
      customerBalance: customer?.financialBalance ?? 0,
      idempotentReplay: true,
    };
  }

  /**
   * Same fan-out as LedgerService.recordPayment (customers list, overview cards,
   * analytics, customer wallet cache) — but AFTER commit, and never fatal: the
   * money is already posted, a Redis hiccup must not turn it into a 500.
   */
  private async invalidateCaches(vendorId: string, customerId: string): Promise<void> {
    try {
      await Promise.all([
        this.cache.invalidateVendorEntity(vendorId, CACHE_KEYS.CUSTOMERS),
        this.cache.invalidateOverview(vendorId),
        this.cache.invalidateAnalytics(vendorId),
        this.cache.invalidateCustomerWallets(vendorId, customerId),
      ]);
    } catch (e) {
      this.logger.warn(
        `Cache invalidation failed after posting an adjustment for customer ${customerId}: ${(e as Error).message}`,
      );
    }
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;
