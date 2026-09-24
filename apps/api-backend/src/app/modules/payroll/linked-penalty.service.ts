import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { CustomerFinancialAdjustment, StaffLedgerEntry } from '@prisma/client';
import { PrismaService } from '@water-supply-crm/database';
import { CacheInvalidationService, CACHE_KEYS } from '@water-supply-crm/caching';
import type { AuthUser } from '@water-supply-crm/types';
import { StaffLedgerService } from './staff-ledger.service';
import { CustomerFinancialAdjustmentService } from '../customer-financial-adjustment/customer-financial-adjustment.service';
import { resolveAdjustmentEffectiveDate } from '../customer-financial-adjustment/adjustment-posting.util';
import { CreateLinkedPenaltyDto } from './dto/create-linked-penalty.dto';
import { VoidStaffLedgerEntryDto } from './dto/void-staff-ledger-entry.dto';

export interface CreateLinkedPenaltyResult {
  penaltyEntry: StaffLedgerEntry;
  customerAdjustment: CustomerFinancialAdjustment;
  customerBalance: number;
}

export interface VoidLinkedPenaltyResult {
  penaltyEntry: StaffLedgerEntry;
  customerAdjustment: CustomerFinancialAdjustment;
  customerBalance: number;
}

/**
 * Linked Penalty (owner-approved 2026-09-25) — wires the two ledgers that
 * `StaffLedgerService` and `CustomerFinancialAdjustmentService` already own
 * independently, for one recurring scenario: a customer paid a staff member
 * (usually a driver) money that was never recorded/deposited. One action
 * both debits that staff member's pay AND credits the customer the same
 * amount — atomically, and cross-linked for traceability in both
 * directions.
 *
 * Deliberately a THIRD service, not a method added to either existing one:
 * `StaffLedgerService` and `CustomerFinancialAdjustmentService` stay mutually
 * unaware of each other (no circular DI) and this orchestrator composes their
 * existing tx-composable cores (`createTx`/`voidEntryTx`/`voidAdjustmentTx`)
 * inside ONE `$transaction` — the same pattern `CrewCashDistributionService`
 * already uses to compose `StaffLedgerService.createTx`/`voidEntryTx` with
 * its own writes.
 *
 * The customer link is entirely OPTIONAL at the ledger-entry level — a plain
 * PENALTY/DEDUCTION with no customer involved keeps using
 * `StaffLedgerService.create` exactly as before; this service is only reached
 * when the caller explicitly opts into linking one.
 */
@Injectable()
export class LinkedPenaltyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly staffLedger: StaffLedgerService,
    private readonly customerAdjustment: CustomerFinancialAdjustmentService,
    private readonly cache: CacheInvalidationService,
  ) {}

  /**
   * Posts, in ONE database transaction:
   *   1. a STAFF_FAULT_CREDIT `CustomerFinancialAdjustment` crediting
   *      `dto.customerId` by `Math.abs(dto.amount)`,
   *   2. a `StaffLedgerEntry` (`dto.category`, `dto.amount` — already
   *      negative) against `dto.userId`, with `linkedCustomerId` /
   *      `causedCustomerAdjustmentId` pointing at (1),
   * so the customer's balance and the employee's payroll always move
   * together — never one without the other.
   */
  async createLinkedPenalty(user: AuthUser, dto: CreateLinkedPenaltyDto): Promise<CreateLinkedPenaltyResult> {
    const { vendorId } = user;

    const [employee, customer] = await Promise.all([
      this.prisma.user.findFirst({ where: { id: dto.userId, vendorId }, select: { id: true, name: true } }),
      this.prisma.customer.findFirst({ where: { id: dto.customerId, vendorId }, select: { id: true } }),
    ]);
    if (!employee) throw new NotFoundException('Employee not found.');
    if (!customer) throw new NotFoundException('Customer not found.');

    const effectiveDate = resolveAdjustmentEffectiveDate(dto.effectiveDate);
    const creditAmount = Math.abs(dto.amount);
    const internalNote = `Linked to a ${dto.category.toLowerCase()} against ${employee.name}${
      dto.description ? `: ${dto.description}` : '.'
    }`;

    const { penaltyEntry, customerAdjustment } = await this.prisma.$transaction(async (tx) => {
      const { adjustment } = await this.customerAdjustment.createTx(tx, user, {
        customerId: dto.customerId,
        kind: 'STAFF_FAULT_CREDIT',
        direction: 'CREDIT',
        amount: creditAmount,
        effectiveDate,
        title: dto.customerCreditTitle,
        internalNote,
        visibility: 'ITEMIZED',
      });

      const entry = await this.staffLedger.createTx(tx, user, {
        userId: dto.userId,
        category: dto.category,
        amount: dto.amount,
        // Same resolved instant as the customer credit above (not the raw
        // dto string) so both halves of one real-world event share one
        // timestamp — resolveAdjustmentEffectiveDate applies the vendor-day
        // rules (no future dates, backdating capped to the current month).
        effectiveDate: effectiveDate.toISOString(),
        description: dto.description,
        linkedCustomerId: dto.customerId,
        causedCustomerAdjustmentId: adjustment.id,
      });

      return { penaltyEntry: entry, customerAdjustment: adjustment };
    });

    await this.invalidateCaches(vendorId, dto.customerId);

    const refreshedCustomer = await this.prisma.customer.findUniqueOrThrow({
      where: { id: dto.customerId },
      select: { financialBalance: true },
    });
    return { penaltyEntry, customerAdjustment, customerBalance: refreshedCustomer.financialBalance };
  }

  /**
   * Voids a linked penalty entry AND its paired customer credit together, in
   * ONE transaction — the owner's explicit choice over voiding each side
   * independently (a mismatch would leave the customer credited without the
   * staff member ever being docked, or vice versa).
   */
  async voidLinkedPenalty(
    user: AuthUser,
    staffLedgerEntryId: string,
    dto: VoidStaffLedgerEntryDto,
  ): Promise<VoidLinkedPenaltyResult> {
    const { vendorId } = user;

    const entry = await this.prisma.staffLedgerEntry.findFirst({
      where: { id: staffLedgerEntryId, vendorId },
    });
    if (!entry) throw new NotFoundException('Ledger entry not found.');
    if (!entry.causedCustomerAdjustmentId) {
      throw new BadRequestException('This ledger entry is not linked to a customer credit — use the plain void action instead.');
    }
    const adjustmentId = entry.causedCustomerAdjustmentId;

    const { penaltyEntry, customerAdjustment } = await this.prisma.$transaction(async (tx) => {
      const voidedEntry = await this.staffLedger.voidEntryTx(tx, user, staffLedgerEntryId, dto, {
        skipLinkGuard: true,
      });
      const voidedAdjustment = await this.customerAdjustment.voidAdjustmentTx(
        tx,
        user,
        adjustmentId,
        dto.reason,
        { skipLinkGuard: true },
      );
      return { penaltyEntry: voidedEntry, customerAdjustment: voidedAdjustment.adjustment };
    });

    await this.invalidateCaches(vendorId, customerAdjustment.customerId);

    const refreshedCustomer = await this.prisma.customer.findUniqueOrThrow({
      where: { id: customerAdjustment.customerId },
      select: { financialBalance: true },
    });
    return { penaltyEntry, customerAdjustment, customerBalance: refreshedCustomer.financialBalance };
  }

  private async invalidateCaches(vendorId: string, customerId: string): Promise<void> {
    try {
      await Promise.all([
        this.cache.invalidateVendorEntity(vendorId, CACHE_KEYS.CUSTOMERS),
        this.cache.invalidateOverview(vendorId),
        this.cache.invalidateAnalytics(vendorId),
        this.cache.invalidateCustomerWallets(vendorId, customerId),
      ]);
    } catch {
      // Money is already posted; a cache-invalidation hiccup must not turn it into a 500.
    }
  }
}
