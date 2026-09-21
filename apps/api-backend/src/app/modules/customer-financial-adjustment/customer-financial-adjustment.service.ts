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
import { CreateCustomerFinancialAdjustmentDto } from './dto/create-customer-financial-adjustment.dto';
import {
  POSTABLE_ADJUSTMENT_KINDS,
  customerFacingAdjustmentText,
  normalizeAdjustmentAmount,
  resolveAdjustmentEffectiveDate,
  signedAdjustmentAmount,
} from './adjustment-posting.util';

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
 * Slice scope (2A): charge and credit kinds only. Void/reversal, transfers,
 * write-off/correction, list/get, statement and analytics arrive in later slices.
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
    // Every postable kind has a FIXED direction/visibility; guard + narrow the types.
    if (
      policy.direction === 'EITHER' ||
      policy.direction === 'DERIVED' ||
      policy.visibility === 'DERIVED'
    ) {
      throw new BadRequestException(`Adjustment kind ${dto.kind} cannot be posted yet.`);
    }
    const direction: AdjustmentDirection = policy.direction;
    const visibility: AdjustmentVisibility = policy.visibility;

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

    const fingerprint = { customerId: dto.customerId, kind: dto.kind, amount, title };

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
    fingerprint: { customerId: string; kind: string; amount: number; title: string },
  ): Promise<CreateAdjustmentResult> {
    const same =
      prior.customerId === fingerprint.customerId &&
      prior.kind === fingerprint.kind &&
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
