import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  DepositEntryDirection,
  DepositEntrySource,
  DepositType,
  Prisma,
  type CustomerDeposit,
  type CustomerDepositEntry,
} from '@prisma/client';
import { PrismaService } from '@water-supply-crm/database';
import { CacheInvalidationService, CACHE_KEYS } from '@water-supply-crm/caching';
import type { AuthUser } from '@water-supply-crm/types';
import { PermissionService } from '../authz/permission.service';
import { CustomerFinancialAdjustmentService } from '../customer-financial-adjustment/customer-financial-adjustment.service';
import { CollectDepositDto } from './dto/collect-deposit.dto';
import { RefundDepositDto } from './dto/refund-deposit.dto';
import { WRITE_OFF_NOTE_MIN_LENGTH, WriteOffDepositDto } from './dto/write-off-deposit.dto';
import { VOID_REASON_MIN_LENGTH, VoidDepositEntryDto } from './dto/void-deposit-entry.dto';
import { ApplyDepositToBalanceDto } from './dto/apply-deposit-to-balance.dto';
import {
  normalizeDepositAmount,
  oppositeDepositDirection,
  resolveDepositEffectiveDate,
  signedDepositAmount,
} from './deposit-posting.util';

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Included on every read so the Deposits tab has customer/product/entry-author names in one call. */
const DEPOSIT_READ_INCLUDE = {
  product: { select: { id: true, name: true } },
  entries: {
    orderBy: { effectiveDate: 'desc' },
    include: {
      createdBy: { select: { id: true, name: true } },
      voidedBy: { select: { id: true, name: true } },
      reversalOf: { select: { id: true, direction: true, amount: true, effectiveDate: true } },
      reversedBy: { select: { id: true, direction: true, amount: true, effectiveDate: true } },
    },
  },
} satisfies Prisma.CustomerDepositInclude;

export interface CollectDepositResult {
  deposit: CustomerDeposit;
  entry: CustomerDepositEntry;
}

export interface VoidDepositEntryResult {
  entry: CustomerDepositEntry;
  reversal: CustomerDepositEntry;
  deposit: CustomerDeposit;
}

/**
 * Customer Deposits (owner-requested 2026-09-29) — an optional, per-customer
 * refundable security deposit (CASH or BOTTLE), deliberately kept separate
 * from CustomerFinancialAdjustment/Customer.financialBalance/BottleWallet: a
 * deposit is a held liability, never a charge/credit or a normal circulating
 * bottle. Gated vendor-wide by Vendor.depositsEnabled.
 *
 * Mirrors CustomerFinancialAdjustmentService's ledger-first, void-by-reversal
 * design: `collect`/`refund`/`writeOff` each write, in ONE database
 * transaction, the CustomerDepositEntry row + the CustomerDeposit.balance
 * update + the audit-log row. A mistake is voided by a REVERSAL entry, never
 * edited or deleted.
 *
 * Office-side only (source = OFFICE) in this slice. Driver-side collection
 * during a delivery (source = DELIVERY, via SubmitDeliveryDto) is a later
 * slice and posts through `collectTx` directly from DailySheetService's own
 * transaction.
 */
@Injectable()
export class CustomerDepositsService {
  private readonly logger = new Logger(CustomerDepositsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheInvalidationService,
    private readonly permissions: PermissionService,
    private readonly adjustments: CustomerFinancialAdjustmentService,
  ) {}

  /** Staff read: every deposit (CASH + one per BOTTLE product) this customer has, with entry history. */
  async listForCustomer(vendorId: string, customerId: string): Promise<CustomerDeposit[]> {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, vendorId },
      select: { id: true },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    return this.prisma.customerDeposit.findMany({
      where: { vendorId, customerId },
      include: DEPOSIT_READ_INCLUDE,
      orderBy: { createdAt: 'asc' },
    });
  }

  async collect(user: AuthUser, customerId: string, dto: CollectDepositDto): Promise<CollectDepositResult> {
    const { vendorId } = user;

    if (!(await this.permissions.can(user.userId, 'customer_deposits:collect'))) {
      throw new ForbiddenException('You do not have permission to collect a deposit.');
    }
    await this.assertDepositsEnabled(vendorId);

    const amount = normalizeDepositAmount(dto.type, dto.amount);
    if (dto.type === DepositType.BOTTLE && !dto.productId) {
      throw new BadRequestException('A bottle deposit requires a product.');
    }
    if (dto.type === DepositType.CASH && dto.productId) {
      throw new BadRequestException('A cash deposit cannot be linked to a product.');
    }
    if (dto.productId) {
      const product = await this.prisma.product.findFirst({
        where: { id: dto.productId, vendorId },
        select: { id: true },
      });
      if (!product) throw new NotFoundException('Product not found');
    }

    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, vendorId },
      select: { id: true },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    const effectiveDate = resolveDepositEffectiveDate(dto.effectiveDate);

    const result = await this.prisma.$transaction((tx) =>
      this.collectTx(tx, user, {
        customerId,
        type: dto.type,
        productId: dto.productId,
        amount,
        source: DepositEntrySource.OFFICE,
        effectiveDate,
        note: dto.note?.trim() || undefined,
        referenceNo: dto.referenceNo?.trim() || undefined,
      }),
    );

    await this.invalidateCaches(vendorId, customerId);
    return result;
  }

  /**
   * Core of `collect`, composable into an externally-managed transaction —
   * same tx-parameterized pattern as CustomerFinancialAdjustmentService's
   * `createTx`. Used by `collect` itself, and (a later slice) by
   * DailySheetService.submitDelivery for a driver's in-delivery collection
   * (source = DELIVERY, with dailySheetItemId set).
   *
   * Every field here is ALREADY RESOLVED (permission checked, deposit-enabled
   * gate checked, type/product validated, amount normalized, customer
   * tenancy confirmed) — the caller owns all of that outside the transaction.
   */
  async collectTx(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    input: {
      customerId: string;
      type: DepositType;
      productId?: string;
      amount: number;
      source: DepositEntrySource;
      effectiveDate: Date;
      note?: string;
      referenceNo?: string;
      dailySheetItemId?: string;
    },
  ): Promise<CollectDepositResult> {
    const { vendorId } = user;
    const deposit = await this.getOrCreateDepositTx(tx, vendorId, input.customerId, input.type, input.productId);

    const entry = await tx.customerDepositEntry.create({
      data: {
        vendorId,
        depositId: deposit.id,
        direction: DepositEntryDirection.COLLECT,
        amount: input.amount,
        source: input.source,
        effectiveDate: input.effectiveDate,
        note: input.note,
        referenceNo: input.referenceNo,
        dailySheetItemId: input.dailySheetItemId,
        createdById: user.userId,
      },
    });

    const updatedDeposit = await tx.customerDeposit.update({
      where: { id: deposit.id },
      data: { balance: { increment: input.amount } },
    });

    await tx.auditLog.create({
      data: {
        vendorId,
        userId: user.userId,
        userName: user.name,
        action: 'CREATE',
        entity: 'CustomerDepositEntry',
        entityId: entry.id,
        changes: {
          before: { balance: round2(updatedDeposit.balance - input.amount) },
          after: {
            customerId: input.customerId,
            type: input.type,
            productId: input.productId ?? null,
            direction: 'COLLECT',
            amount: input.amount,
            source: input.source,
            effectiveDate: input.effectiveDate.toISOString(),
            balance: updatedDeposit.balance,
          },
          ...(input.note ? { reason: input.note } : {}),
        } as Prisma.InputJsonValue,
      },
    });

    return { deposit: updatedDeposit, entry };
  }

  /**
   * Driver-side (source = DELIVERY): syncs a delivery item's up-to-3 deposit
   * slots — CASH collect, BOTTLE collect, BOTTLE return — with a single
   * SubmitDeliveryDto submission. Called from DailySheetService.submitDelivery
   * inside its own transaction, alongside (never mixed into) LedgerService's
   * financialBalance/BottleWallet math.
   *
   * A driver can RESUBMIT the same delivery item (edit before close, or a
   * staff-unlocked force-resubmit), so this is a SYNC, not a blind append —
   * same idempotent-repost spirit as LedgerService.recordDelivery, but
   * implemented as update-or-delete-in-place per slot (DELIVERY entries are
   * mutable-per-item, unlike office entries, which stay append-only/void-by-
   * reversal). Each slot is keyed by (dailySheetItemId, direction, deposit
   * type) — cash and bottle both use direction=COLLECT, so the deposit TYPE
   * is what tells the two slots apart.
   */
  async syncDeliveryEntriesTx(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    input: {
      customerId: string;
      dailySheetItemId: string;
      effectiveDate: Date;
      cashCollected: number;
      bottlesCollected: number;
      bottlesReturned: number;
      bottleProductId?: string;
    },
  ): Promise<void> {
    if (
      input.cashCollected <= 0 &&
      input.bottlesCollected <= 0 &&
      input.bottlesReturned <= 0 &&
      !(await this.hasExistingDeliveryEntries(tx, input.dailySheetItemId))
    ) {
      return;
    }
    if ((input.bottlesCollected > 0 || input.bottlesReturned > 0) && !input.bottleProductId) {
      throw new BadRequestException('A bottle deposit requires a product.');
    }
    if (input.bottleProductId) {
      const product = await tx.product.findFirst({
        where: { id: input.bottleProductId, vendorId: user.vendorId },
        select: { id: true },
      });
      if (!product) throw new BadRequestException('Product not found');
    }

    await this.syncDeliverySlotTx(tx, user, {
      dailySheetItemId: input.dailySheetItemId,
      customerId: input.customerId,
      type: DepositType.CASH,
      direction: DepositEntryDirection.COLLECT,
      targetAmount: input.cashCollected,
      effectiveDate: input.effectiveDate,
    });
    await this.syncDeliverySlotTx(tx, user, {
      dailySheetItemId: input.dailySheetItemId,
      customerId: input.customerId,
      type: DepositType.BOTTLE,
      productId: input.bottleProductId,
      direction: DepositEntryDirection.COLLECT,
      targetAmount: input.bottlesCollected,
      effectiveDate: input.effectiveDate,
    });
    await this.syncDeliverySlotTx(tx, user, {
      dailySheetItemId: input.dailySheetItemId,
      customerId: input.customerId,
      type: DepositType.BOTTLE,
      productId: input.bottleProductId,
      direction: DepositEntryDirection.REFUND,
      targetAmount: input.bottlesReturned,
      effectiveDate: input.effectiveDate,
    });
  }

  private async hasExistingDeliveryEntries(tx: Prisma.TransactionClient, dailySheetItemId: string): Promise<boolean> {
    const count = await tx.customerDepositEntry.count({ where: { dailySheetItemId } });
    return count > 0;
  }

  /** One (dailySheetItemId, direction, type) slot — see syncDeliveryEntriesTx's doc comment. */
  private async syncDeliverySlotTx(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    slot: {
      dailySheetItemId: string;
      customerId: string;
      type: DepositType;
      productId?: string;
      direction: DepositEntryDirection;
      targetAmount: number;
      effectiveDate: Date;
    },
  ): Promise<void> {
    const { vendorId } = user;
    const existing = await tx.customerDepositEntry.findFirst({
      where: { dailySheetItemId: slot.dailySheetItemId, direction: slot.direction, deposit: { type: slot.type } },
      include: { deposit: true },
    });

    if (slot.targetAmount <= 0) {
      if (existing) await this.removeDeliveryEntryTx(tx, existing);
      return;
    }

    // Product changed since the last submission of this item (rare) — the old
    // entry belongs to a different deposit bucket, so move rather than update.
    if (existing && existing.deposit.productId !== (slot.productId ?? null)) {
      await this.removeDeliveryEntryTx(tx, existing);
      await this.createDeliveryEntryTx(tx, user, slot);
      return;
    }

    if (existing) {
      if (existing.amount === slot.targetAmount) return;
      const delta = slot.targetAmount - existing.amount;
      await tx.customerDepositEntry.update({
        where: { id: existing.id },
        data: { amount: slot.targetAmount, effectiveDate: slot.effectiveDate },
      });
      await tx.customerDeposit.update({
        where: { id: existing.depositId },
        data: { balance: { increment: signedDepositAmount(slot.direction, delta) } },
      });
      return;
    }

    await this.createDeliveryEntryTx(tx, user, slot);
  }

  private async createDeliveryEntryTx(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    slot: {
      dailySheetItemId: string;
      customerId: string;
      type: DepositType;
      productId?: string;
      direction: DepositEntryDirection;
      targetAmount: number;
      effectiveDate: Date;
    },
  ): Promise<void> {
    const { vendorId } = user;
    const deposit = await this.getOrCreateDepositTx(tx, vendorId, slot.customerId, slot.type, slot.productId);
    await tx.customerDepositEntry.create({
      data: {
        vendorId,
        depositId: deposit.id,
        direction: slot.direction,
        amount: slot.targetAmount,
        source: DepositEntrySource.DELIVERY,
        effectiveDate: slot.effectiveDate,
        dailySheetItemId: slot.dailySheetItemId,
        createdById: user.userId,
      },
    });
    await tx.customerDeposit.update({
      where: { id: deposit.id },
      data: { balance: { increment: signedDepositAmount(slot.direction, slot.targetAmount) } },
    });
  }

  private async removeDeliveryEntryTx(
    tx: Prisma.TransactionClient,
    existing: CustomerDepositEntry & { deposit: CustomerDeposit },
  ): Promise<void> {
    await tx.customerDepositEntry.delete({ where: { id: existing.id } });
    await tx.customerDeposit.update({
      where: { id: existing.depositId },
      data: { balance: { decrement: signedDepositAmount(existing.direction, existing.amount) } },
    });
  }

  async refund(user: AuthUser, depositId: string, dto: RefundDepositDto): Promise<CollectDepositResult> {
    const { vendorId } = user;

    if (!(await this.permissions.can(user.userId, 'customer_deposits:refund'))) {
      throw new ForbiddenException('You do not have permission to refund a deposit.');
    }
    await this.assertDepositsEnabled(vendorId);

    const deposit = await this.prisma.customerDeposit.findFirst({ where: { id: depositId, vendorId } });
    if (!deposit) throw new NotFoundException('Deposit not found');

    const amount = normalizeDepositAmount(deposit.type, dto.amount);
    if (round2(amount) > round2(deposit.balance)) {
      throw new BadRequestException(
        `Cannot refund more than the held deposit (current: ${deposit.balance}).`,
      );
    }
    const effectiveDate = resolveDepositEffectiveDate(dto.effectiveDate);

    const result = await this.prisma.$transaction((tx) =>
      this.closeOutTx(tx, user, deposit, {
        direction: DepositEntryDirection.REFUND,
        amount,
        effectiveDate,
        note: dto.note?.trim() || undefined,
        referenceNo: dto.referenceNo?.trim() || undefined,
      }),
    );

    await this.invalidateCaches(vendorId, deposit.customerId);
    return result;
  }

  /**
   * Closure Settlement (owner-requested 2026-09-29) — CASH deposits only.
   * Returns part or all of the held deposit to the customer as a CREDIT
   * against `Customer.financialBalance` instead of physical cash: one
   * transaction posts (1) a CustomerDepositEntry (direction=APPLIED_TO_BALANCE,
   * reduces the deposit balance, no Cash Ledger movement — nothing physically
   * left the office) and (2) an OTHER_CREDIT CustomerFinancialAdjustment for
   * the same amount, via CustomerFinancialAdjustmentService.createTx (the same
   * tx-composable primitive LinkedPenaltyService already uses to cross-post
   * atomically into that ledger). Gated on `customer_deposits:refund` — same
   * tier as a cash refund, since this is a deposit-side action; every role
   * that holds it already holds `customer_financial_adjustments:create_credit`
   * too (Accountant / Vendor Admin), so there is no practical permission gap.
   */
  async applyToBalance(
    user: AuthUser,
    depositId: string,
    dto: ApplyDepositToBalanceDto,
  ): Promise<CollectDepositResult & { adjustmentId: string }> {
    const { vendorId } = user;

    if (!(await this.permissions.can(user.userId, 'customer_deposits:refund'))) {
      throw new ForbiddenException('You do not have permission to refund a deposit.');
    }
    await this.assertDepositsEnabled(vendorId);

    const deposit = await this.prisma.customerDeposit.findFirst({ where: { id: depositId, vendorId } });
    if (!deposit) throw new NotFoundException('Deposit not found');
    if (deposit.type !== DepositType.CASH) {
      throw new BadRequestException('Only a CASH deposit can be applied to the customer’s balance.');
    }

    const amount = normalizeDepositAmount(deposit.type, dto.amount);
    if (round2(amount) > round2(deposit.balance)) {
      throw new BadRequestException(
        `Cannot apply more than the held deposit (current: ${deposit.balance}).`,
      );
    }
    const effectiveDate = resolveDepositEffectiveDate(dto.effectiveDate);
    const note = dto.note?.trim() || undefined;

    const result = await this.prisma.$transaction(async (tx) => {
      const entry = await tx.customerDepositEntry.create({
        data: {
          vendorId,
          depositId: deposit.id,
          direction: DepositEntryDirection.APPLIED_TO_BALANCE,
          amount,
          source: DepositEntrySource.OFFICE,
          effectiveDate,
          note,
          createdById: user.userId,
        },
      });

      const updatedDeposit = await tx.customerDeposit.update({
        where: { id: deposit.id },
        data: { balance: { decrement: amount } },
      });
      if (round2(updatedDeposit.balance) < 0) {
        throw new BadRequestException('This deposit does not hold enough balance for this amount.');
      }

      const { adjustment } = await this.adjustments.createTx(tx, user, {
        customerId: deposit.customerId,
        kind: 'OTHER_CREDIT',
        direction: 'CREDIT',
        amount,
        effectiveDate,
        title: 'Deposit applied to balance',
        internalNote: note ?? `Applied from a customer deposit (entry ${entry.id}).`,
        referenceNo: entry.id,
        visibility: 'ITEMIZED',
      });

      await tx.customerDepositEntry.update({
        where: { id: entry.id },
        data: { referenceNo: adjustment.id },
      });

      await tx.auditLog.create({
        data: {
          vendorId,
          userId: user.userId,
          userName: user.name,
          action: 'APPLY_TO_BALANCE',
          entity: 'CustomerDepositEntry',
          entityId: entry.id,
          changes: {
            before: { balance: round2(updatedDeposit.balance + amount) },
            after: {
              customerId: deposit.customerId,
              amount,
              balance: updatedDeposit.balance,
              adjustmentId: adjustment.id,
            },
            ...(note ? { reason: note } : {}),
          } as Prisma.InputJsonValue,
        },
      });

      return { deposit: updatedDeposit, entry, adjustmentId: adjustment.id };
    });

    await this.invalidateCaches(vendorId, deposit.customerId);
    return result;
  }

  async writeOff(user: AuthUser, depositId: string, dto: WriteOffDepositDto): Promise<CollectDepositResult> {
    const { vendorId } = user;

    if (!(await this.permissions.can(user.userId, 'customer_deposits:write_off'))) {
      throw new ForbiddenException('You do not have permission to write off a deposit.');
    }
    await this.assertDepositsEnabled(vendorId);

    const note = (dto.note ?? '').trim();
    if (note.length < WRITE_OFF_NOTE_MIN_LENGTH) {
      throw new BadRequestException(
        `A note of at least ${WRITE_OFF_NOTE_MIN_LENGTH} characters is required to write off a deposit.`,
      );
    }

    const deposit = await this.prisma.customerDeposit.findFirst({ where: { id: depositId, vendorId } });
    if (!deposit) throw new NotFoundException('Deposit not found');

    const amount = normalizeDepositAmount(deposit.type, dto.amount);
    if (round2(amount) > round2(deposit.balance)) {
      throw new BadRequestException(
        `Cannot write off more than the held deposit (current: ${deposit.balance}).`,
      );
    }
    const effectiveDate = resolveDepositEffectiveDate(dto.effectiveDate);

    const result = await this.prisma.$transaction((tx) =>
      this.closeOutTx(tx, user, deposit, {
        direction: DepositEntryDirection.WRITE_OFF,
        amount,
        effectiveDate,
        note,
      }),
    );

    await this.invalidateCaches(vendorId, deposit.customerId);
    return result;
  }

  /**
   * Closure Settlement (owner-requested 2026-09-29) — tx-composable, for
   * CustomerService.deactivate()'s force path: writes off WHATEVER remains on
   * an active deposit (mirrors force_deactivate/force_deactivate_bottles
   * writing off financialBalance/BottleWallet), so a force-deactivated
   * customer's deposit is never silently orphaned. Caller owns the
   * `customer_deposits:write_off` permission check.
   */
  async writeOffTx(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    deposit: Pick<CustomerDeposit, 'id' | 'customerId' | 'type' | 'productId' | 'balance'>,
    note: string,
  ): Promise<CollectDepositResult> {
    return this.closeOutTx(tx, user, deposit, {
      direction: DepositEntryDirection.WRITE_OFF,
      amount: deposit.balance,
      effectiveDate: new Date(),
      note,
    });
  }

  private async closeOutTx(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    deposit: Pick<CustomerDeposit, 'id' | 'customerId' | 'type' | 'productId' | 'balance'>,
    input: {
      direction: Extract<DepositEntryDirection, 'REFUND' | 'WRITE_OFF'>;
      amount: number;
      effectiveDate: Date;
      note?: string;
      referenceNo?: string;
    },
  ): Promise<CollectDepositResult> {
    const { vendorId } = user;

    const entry = await tx.customerDepositEntry.create({
      data: {
        vendorId,
        depositId: deposit.id,
        direction: input.direction,
        amount: input.amount,
        source: DepositEntrySource.OFFICE,
        effectiveDate: input.effectiveDate,
        note: input.note,
        referenceNo: input.referenceNo,
        createdById: user.userId,
      },
    });

    // Row-locked by the update itself — a race with another close-out on the
    // same deposit can't push the balance negative between the read above and here.
    const updatedDeposit = await tx.customerDeposit.update({
      where: { id: deposit.id },
      data: { balance: { decrement: input.amount } },
    });
    if (round2(updatedDeposit.balance) < 0) {
      throw new BadRequestException('This deposit does not hold enough balance for this amount.');
    }

    await tx.auditLog.create({
      data: {
        vendorId,
        userId: user.userId,
        userName: user.name,
        action: input.direction === 'REFUND' ? 'REFUND' : 'WRITE_OFF',
        entity: 'CustomerDepositEntry',
        entityId: entry.id,
        changes: {
          before: { balance: round2(updatedDeposit.balance + input.amount) },
          after: {
            customerId: deposit.customerId,
            type: deposit.type,
            productId: deposit.productId,
            direction: input.direction,
            amount: input.amount,
            effectiveDate: input.effectiveDate.toISOString(),
            balance: updatedDeposit.balance,
          },
          ...(input.note ? { reason: input.note } : {}),
        } as Prisma.InputJsonValue,
      },
    });

    return { deposit: updatedDeposit, entry };
  }

  async voidEntry(user: AuthUser, entryId: string, dto: VoidDepositEntryDto): Promise<VoidDepositEntryResult> {
    const { vendorId } = user;

    if (!(await this.permissions.can(user.userId, 'customer_deposits:void'))) {
      throw new ForbiddenException('You do not have permission to void deposit entries.');
    }

    const reason = (dto.reason ?? '').trim();
    if (reason.length < VOID_REASON_MIN_LENGTH) {
      throw new BadRequestException(
        `A reason of at least ${VOID_REASON_MIN_LENGTH} characters is required to void a deposit entry.`,
      );
    }

    let done: VoidDepositEntryResult;
    try {
      done = await this.prisma.$transaction((tx) => this.voidEntryTx(tx, user, entryId, reason));
    } catch (err) {
      // The unique reversalOfId is the database-level "reversed at most once" guard.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('This entry has already been voided.');
      }
      throw err;
    }

    await this.invalidateCaches(vendorId, done.deposit.customerId);
    return done;
  }

  private async voidEntryTx(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    entryId: string,
    reason: string,
  ): Promise<VoidDepositEntryResult> {
    const { vendorId } = user;

    const original = await tx.customerDepositEntry.findFirst({
      where: { id: entryId, vendorId },
      include: { deposit: true },
    });
    if (!original) throw new NotFoundException('Deposit entry not found');

    if (original.reversalOfId) {
      throw new BadRequestException('A reversal cannot be voided. To undo it, post a new entry.');
    }
    if (original.status === 'VOIDED') {
      throw new ConflictException('This entry has already been voided.');
    }

    const voidedAt = new Date();
    const reversalDirection = oppositeDepositDirection(original.direction);

    // (1) Claim the original FIRST — same idempotent-claim pattern as
    // CustomerFinancialAdjustmentService.voidAdjustmentTx.
    const claimed = await tx.customerDepositEntry.updateMany({
      where: { id: original.id, vendorId, status: 'POSTED' },
      data: { status: 'VOIDED', voidedById: user.userId, voidedAt, voidReason: reason },
    });
    if (claimed.count === 0) {
      throw new ConflictException('This entry has already been voided.');
    }

    // (2) The reversal entry.
    const reversal = await tx.customerDepositEntry.create({
      data: {
        vendorId,
        depositId: original.depositId,
        direction: reversalDirection,
        amount: original.amount,
        source: original.source,
        effectiveDate: voidedAt,
        note: `Reversal: ${reason}`,
        createdById: user.userId,
        reversalOfId: original.id,
      },
    });

    // (3) Balance — exact negation of the original's signed contribution.
    const reversalSigned = signedDepositAmount(reversalDirection, original.amount);
    const updatedDeposit = await tx.customerDeposit.update({
      where: { id: original.depositId },
      data: { balance: { increment: reversalSigned } },
    });
    if (round2(updatedDeposit.balance) < 0) {
      throw new BadRequestException(
        'Voiding this entry would take the deposit balance negative. Contact support.',
      );
    }

    await tx.auditLog.create({
      data: {
        vendorId,
        userId: user.userId,
        userName: user.name,
        action: 'VOID',
        entity: 'CustomerDepositEntry',
        entityId: original.id,
        changes: {
          before: { balance: round2(updatedDeposit.balance - reversalSigned) },
          after: { balance: updatedDeposit.balance, reversalEntryId: reversal.id },
          reason,
        } as Prisma.InputJsonValue,
      },
    });

    // Re-fetch so the returned entry reflects VOIDED (the `original` object in
    // hand is a pre-claim snapshot) — same pattern as
    // CustomerFinancialAdjustmentService.voidAdjustmentTx.
    const voided = await tx.customerDepositEntry.findUniqueOrThrow({ where: { id: original.id } });
    return { entry: voided, reversal, deposit: updatedDeposit };
  }

  /** Find-or-create the (customerId, type, productId) deposit row, tx-scoped for atomicity with the first entry. */
  private async getOrCreateDepositTx(
    tx: Prisma.TransactionClient,
    vendorId: string,
    customerId: string,
    type: DepositType,
    productId?: string,
  ): Promise<CustomerDeposit> {
    const existing = await tx.customerDeposit.findUnique({
      where: { customerId_type_productId: { customerId, type, productId: productId ?? null } },
    });
    if (existing) return existing;

    return tx.customerDeposit.create({
      data: { vendorId, customerId, type, productId },
    });
  }

  private async assertDepositsEnabled(vendorId: string): Promise<void> {
    const vendor = await this.prisma.vendor.findUnique({
      where: { id: vendorId },
      select: { depositsEnabled: true },
    });
    if (!vendor?.depositsEnabled) {
      throw new BadRequestException('Deposits are not enabled for this vendor.');
    }
  }

  async getConfig(vendorId: string): Promise<{ depositsEnabled: boolean }> {
    const vendor = await this.prisma.vendor.findUnique({
      where: { id: vendorId },
      select: { depositsEnabled: true },
    });
    if (!vendor) throw new NotFoundException('Vendor not found');
    return { depositsEnabled: vendor.depositsEnabled };
  }

  async updateConfig(user: AuthUser, depositsEnabled: boolean): Promise<{ depositsEnabled: boolean }> {
    if (!(await this.permissions.can(user.userId, 'customer_deposits:manage_config'))) {
      throw new ForbiddenException('You do not have permission to change the deposits setting.');
    }
    const vendor = await this.prisma.vendor.update({
      where: { id: user.vendorId },
      data: { depositsEnabled },
      select: { depositsEnabled: true },
    });
    await this.cache.invalidateVendorEntity(user.vendorId, CACHE_KEYS.CUSTOMERS);
    return vendor;
  }

  private async invalidateCaches(vendorId: string, customerId: string): Promise<void> {
    try {
      await Promise.all([
        this.cache.invalidateVendorEntity(vendorId, CACHE_KEYS.CUSTOMERS),
        this.cache.invalidateCustomerWallets(vendorId, customerId),
      ]);
    } catch (e) {
      this.logger.warn(
        `Cache invalidation failed after a deposit change for customer ${customerId}: ${(e as Error).message}`,
      );
    }
  }
}
