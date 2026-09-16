import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { FuelCardTopUpStatus } from '@prisma/client';
import type { AuthUser } from '@water-supply-crm/types';
import { paginate } from '../../common/helpers/paginate';
import { AuditService } from '../audit/audit.service';
import { CreateFuelCardDto } from './dto/create-fuel-card.dto';
import { UpdateFuelCardDto } from './dto/update-fuel-card.dto';
import { CreateFuelCardTopUpDto } from './dto/create-fuel-card-topup.dto';
import { VoidFuelCardTopUpDto } from './dto/void-fuel-card-topup.dto';
import { FuelCardTopUpQueryDto } from './dto/fuel-card-topup-query.dto';

/** Money is reported to 2dp — float sums otherwise leak 0.30000000000000004-style noise. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

const topUpInclude = {
  fuelCard: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  voidedBy: { select: { id: true, name: true } },
};

/**
 * Fuel Card Wallet (owner-requested 2026-09-15). Fixes a real double-count: a
 * fuel card top-up (office cash -> the card) was being logged as a generic
 * Expense, while the fuel actually filled into a vehicle from that card ALSO
 * generated its own FUEL_EXPENSE via FuelLog — the same rupee counted as a
 * company cost twice.
 *
 * A top-up is a transfer between two custodial cash pools, not an Expense —
 * it draws down the Office Cash Ledger's available balance (see
 * VanCashLedgerService.computeAvailableBalance/getStats/getTimeline, the same
 * tier OfficeCashRemittance occupies) but never creates an Expense row. The
 * real cost is still, and only, recognized at the FuelLog fill
 * (FuelLogService.create already spawns FUEL_EXPENSE there, unchanged).
 *
 * Each card's balance = openingBalance + Σ(ACTIVE top-ups) −
 * Σ(FuelLog.amountPaid fuelled from that card), computed on read (not
 * cached), same convention VanCashLedgerService uses for `availableBalance`.
 * openingBalance is a one-time carry-forward baseline (set at/after card
 * registration) and never touches Office Cash Ledger.
 */
@Injectable()
export class FuelCardService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  // ── Cards ──────────────────────────────────────────────────────────────

  async createCard(user: AuthUser, dto: CreateFuelCardDto) {
    const card = await this.prisma.fuelCard.create({
      data: {
        vendorId: user.vendorId,
        name: dto.name,
        cardNumber: dto.cardNumber ?? null,
        issuer: dto.issuer ?? null,
        openingBalance: dto.openingBalance ?? 0,
        createdById: user.userId,
      },
    });

    await this.audit.log({
      vendorId: user.vendorId,
      userId: user.userId,
      userName: user.name,
      action: 'CREATED',
      entity: 'FuelCard',
      entityId: card.id,
      changes: {
        after: { name: card.name, cardNumber: card.cardNumber, issuer: card.issuer, openingBalance: card.openingBalance },
      },
    });

    return { ...card, balance: round2(card.openingBalance) };
  }

  async listCards(vendorId: string) {
    const cards = await this.prisma.fuelCard.findMany({
      where: { vendorId },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });

    return Promise.all(
      cards.map(async (card) => ({
        ...card,
        balance: await this.computeCardBalance(vendorId, card.id, card.openingBalance),
      })),
    );
  }

  async updateCard(user: AuthUser, id: string, dto: UpdateFuelCardDto) {
    const before = await this.prisma.fuelCard.findFirst({ where: { id, vendorId: user.vendorId } });
    if (!before) throw new NotFoundException('Fuel card not found.');

    const updated = await this.prisma.fuelCard.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.cardNumber !== undefined && { cardNumber: dto.cardNumber }),
        ...(dto.issuer !== undefined && { issuer: dto.issuer }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        ...(dto.openingBalance !== undefined && { openingBalance: dto.openingBalance }),
      },
    });

    await this.audit.log({
      vendorId: user.vendorId,
      userId: user.userId,
      userName: user.name,
      action: 'UPDATED',
      entity: 'FuelCard',
      entityId: updated.id,
      changes: {
        before: {
          name: before.name,
          cardNumber: before.cardNumber,
          issuer: before.issuer,
          isActive: before.isActive,
          openingBalance: before.openingBalance,
        },
        after: {
          name: updated.name,
          cardNumber: updated.cardNumber,
          issuer: updated.issuer,
          isActive: updated.isActive,
          openingBalance: updated.openingBalance,
        },
      },
    });

    return { ...updated, balance: await this.computeCardBalance(user.vendorId, updated.id, updated.openingBalance) };
  }

  // ── Top-ups ────────────────────────────────────────────────────────────

  async createTopUp(user: AuthUser, fuelCardId: string, dto: CreateFuelCardTopUpDto) {
    const card = await this.prisma.fuelCard.findFirst({ where: { id: fuelCardId, vendorId: user.vendorId } });
    if (!card) throw new NotFoundException('Fuel card not found.');
    if (!card.isActive) throw new BadRequestException('This fuel card is inactive.');

    const created = await this.prisma.fuelCardTopUp.create({
      data: {
        vendorId: user.vendorId,
        fuelCardId,
        amount: dto.amount,
        date: new Date(dto.date),
        reference: dto.reference ?? null,
        attachmentKey: dto.attachmentKey ?? null,
        note: dto.note ?? null,
        status: FuelCardTopUpStatus.ACTIVE,
        createdById: user.userId,
      },
      include: topUpInclude,
    });

    await this.audit.log({
      vendorId: user.vendorId,
      userId: user.userId,
      userName: user.name,
      action: 'CREATED',
      entity: 'FuelCardTopUp',
      entityId: created.id,
      changes: {
        after: { fuelCardId, amount: created.amount, date: created.date, reference: created.reference },
      },
    });

    return { ...created, cardBalance: await this.computeCardBalance(user.vendorId, fuelCardId, card.openingBalance) };
  }

  async listTopUps(vendorId: string, query: FuelCardTopUpQueryDto) {
    const { page = 1, limit = 20, fuelCardId, dateFrom, dateTo } = query;
    const where: Record<string, unknown> = { vendorId };
    if (fuelCardId) where.fuelCardId = fuelCardId;
    if (dateFrom || dateTo) {
      const date: { gte?: Date; lte?: Date } = {};
      if (dateFrom) date.gte = new Date(dateFrom);
      if (dateTo) {
        const end = new Date(dateTo);
        end.setHours(23, 59, 59, 999);
        date.lte = end;
      }
      where.date = date;
    }

    const [data, total] = await Promise.all([
      this.prisma.fuelCardTopUp.findMany({
        where,
        include: topUpInclude,
        orderBy: { date: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.fuelCardTopUp.count({ where }),
    ]);

    return paginate(data, total, page, limit);
  }

  async voidTopUp(user: AuthUser, id: string, dto: VoidFuelCardTopUpDto) {
    const row = await this.prisma.fuelCardTopUp.findFirst({ where: { id, vendorId: user.vendorId } });
    if (!row) throw new NotFoundException('Fuel card top-up not found.');
    if (row.status === FuelCardTopUpStatus.VOIDED) {
      throw new BadRequestException('This top-up is already voided.');
    }

    const claim = await this.prisma.fuelCardTopUp.updateMany({
      where: { id, vendorId: user.vendorId, status: FuelCardTopUpStatus.ACTIVE },
      data: {
        status: FuelCardTopUpStatus.VOIDED,
        voidedById: user.userId,
        voidedAt: new Date(),
        voidReason: dto.voidReason,
      },
    });
    if (claim.count === 0) {
      throw new BadRequestException('This top-up was already voided by someone else. Reload and retry.');
    }

    const updated = await this.prisma.fuelCardTopUp.findUniqueOrThrow({
      where: { id },
      include: topUpInclude,
    });

    await this.audit.log({
      vendorId: user.vendorId,
      userId: user.userId,
      userName: user.name,
      action: 'VOIDED',
      entity: 'FuelCardTopUp',
      entityId: updated.id,
      changes: {
        before: { status: row.status },
        after: { status: updated.status, voidReason: dto.voidReason },
      },
    });

    const card = await this.prisma.fuelCard.findUnique({
      where: { id: row.fuelCardId },
      select: { openingBalance: true },
    });
    return {
      ...updated,
      cardBalance: await this.computeCardBalance(user.vendorId, row.fuelCardId, card?.openingBalance ?? 0),
    };
  }

  async getTopUpAttachmentKey(vendorId: string, id: string): Promise<string> {
    const row = await this.prisma.fuelCardTopUp.findFirst({
      where: { id, vendorId },
      select: { attachmentKey: true },
    });
    if (!row?.attachmentKey) throw new NotFoundException('No attachment on this top-up.');
    return row.attachmentKey;
  }

  // ── Internal ───────────────────────────────────────────────────────────

  private async computeCardBalance(vendorId: string, fuelCardId: string, openingBalance: number): Promise<number> {
    const [topUpAgg, fillAgg] = await Promise.all([
      this.prisma.fuelCardTopUp.aggregate({
        where: { vendorId, fuelCardId, status: FuelCardTopUpStatus.ACTIVE },
        _sum: { amount: true },
      }),
      this.prisma.fuelLog.aggregate({
        where: { vendorId, fuelCardId },
        _sum: { amountPaid: true },
      }),
    ]);

    return round2(openingBalance + (topUpAgg._sum.amount ?? 0) - (fillAgg._sum.amountPaid ?? 0));
  }
}
