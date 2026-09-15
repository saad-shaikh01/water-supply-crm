import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { CacheInvalidationService } from '@water-supply-crm/caching';
import { DeliveryStatus } from '@prisma/client';
import type { AuthUser } from '@water-supply-crm/types';
import { LedgerService } from '../transaction/ledger.service';
import { AuditService } from '../audit/audit.service';
import { BulkRepriceDeliveriesDto } from './dto/bulk-reprice-deliveries.dto';

/**
 * Bulk Closed Delivery Repricing — retroactively change the per-bottle rate on
 * several already-CLOSED deliveries for one customer in a single
 * management-approved action (docs: see the plan this feature shipped from).
 *
 * Deliberately a SEPARATE service/flow from DailySheetService.correctClosedDelivery:
 * that one is for driver mistakes (isCorrection/correctionNote); this one is a
 * business decision (isRepriced/repricedAt) and needs a durable, queryable
 * audit trail (DeliveryRepricingBatch/Item) rather than N generic AuditLog rows.
 *
 * Reuses LedgerService.recordDelivery()'s idempotent-repost delta engine
 * completely unmodified — since quantities/cashCollected never change here,
 * this is provably a pure Customer.financialBalance delta with zero
 * bottle-wallet effect (see the plan's traced math). It never touches the
 * closed sheet's frozen cashExpected/cashCollected, mirroring the same
 * ACCEPTED DIVERGENCE correctClosedDelivery documents.
 */

interface EligibleItem {
  id: string;
  dailySheetId: string;
  productId: string;
  filledDropped: number;
  emptyReceived: number;
  filledReceived: number;
  cashCollected: number;
  pricePerBottle: number;
  status: DeliveryStatus;
  voidedAt: Date | null;
  sheetDate: Date;
}

@Injectable()
export class DeliveryRepricingService {
  constructor(
    private prisma: PrismaService,
    private ledger: LedgerService,
    private audit: AuditService,
    private cache: CacheInvalidationService,
  ) {}

  async bulkReprice(user: AuthUser, dto: BulkRepriceDeliveriesDto) {
    const vendorId = user.vendorId;
    const itemIds = Array.from(new Set(dto.dailySheetItemIds));

    // ── Pre-transaction eligibility pass — the whole batch fails together if
    // anything is ineligible; nothing is applied partially. ──────────────────
    const items = await this.prisma.dailySheetItem.findMany({
      where: { id: { in: itemIds } },
      select: {
        id: true,
        dailySheetId: true,
        customerId: true,
        productId: true,
        filledDropped: true,
        emptyReceived: true,
        filledReceived: true,
        cashCollected: true,
        pricePerBottle: true,
        status: true,
        voidedAt: true,
        dailySheet: { select: { vendorId: true, isClosed: true, date: true } },
      },
    });

    if (items.length !== itemIds.length) {
      throw new NotFoundException('One or more selected deliveries were not found.');
    }
    if (items.some((i) => i.dailySheet.vendorId !== vendorId)) {
      throw new NotFoundException('One or more selected deliveries were not found.');
    }

    const customerIds = new Set(items.map((i) => i.customerId));
    if (customerIds.size > 1) {
      throw new BadRequestException('All selected deliveries must belong to the same customer.');
    }
    const customerId = items[0].customerId;

    if (items.some((i) => !i.dailySheet.isClosed)) {
      throw new ConflictException('Only deliveries on CLOSED sheets are eligible for bulk repricing.');
    }
    if (items.some((i) => i.voidedAt != null)) {
      throw new ConflictException('One or more selected deliveries are voided and cannot be repriced.');
    }
    if (items.some((i) => i.status !== DeliveryStatus.COMPLETED && i.status !== DeliveryStatus.EMPTY_ONLY)) {
      throw new BadRequestException('Only completed deliveries can be repriced.');
    }

    const eligible: EligibleItem[] = items.map((i) => ({
      id: i.id,
      dailySheetId: i.dailySheetId,
      productId: i.productId,
      filledDropped: i.filledDropped,
      emptyReceived: i.emptyReceived,
      filledReceived: i.filledReceived,
      cashCollected: i.cashCollected,
      pricePerBottle: i.pricePerBottle,
      status: i.status,
      voidedAt: i.voidedAt,
      sheetDate: i.dailySheet.date,
    }));

    const now = new Date();
    const touchedSheetDates = new Set<string>();
    let totalDifference = 0;

    const result = await this.prisma.$transaction(
      async (tx) => {
        const batch = await tx.deliveryRepricingBatch.create({
          data: {
            vendorId,
            customerId,
            newPricePerBottle: dto.newPricePerBottle,
            reason: dto.reason,
            itemCount: eligible.length,
            totalDifference: 0,
            createdById: user.userId,
            createdByName: user.name,
          },
        });

        const itemResults: Array<{
          dailySheetItemId: string;
          oldPricePerBottle: number;
          newPricePerBottle: number;
          oldAmount: number;
          newAmount: number;
          difference: number;
        }> = [];

        for (const item of eligible) {
          // Row lock FIRST (mirrors correctClosedDelivery) — serialises a
          // concurrent void/correct/other-reprice of the same item so the
          // in-txn re-read below sees the prior write's COMMITTED row.
          await tx.$queryRaw`SELECT 1 FROM "DailySheetItem" WHERE id = ${item.id} FOR UPDATE`;

          const fresh = await tx.dailySheetItem.findUnique({
            where: { id: item.id },
            select: { status: true, voidedAt: true },
          });
          if (
            !fresh ||
            fresh.voidedAt ||
            (fresh.status !== DeliveryStatus.COMPLETED && fresh.status !== DeliveryStatus.EMPTY_ONLY)
          ) {
            throw new ConflictException(
              `Delivery ${item.id} is no longer in a repriceable state — the whole batch was rolled back.`,
            );
          }

          const oldPricePerBottle = item.pricePerBottle;
          const oldAmount = item.filledDropped * oldPricePerBottle;
          const newAmount = item.filledDropped * dto.newPricePerBottle;
          const difference = newAmount - oldAmount;

          try {
            await this.ledger.recordDelivery(
              {
                vendorId,
                customerId,
                productId: item.productId,
                dailySheetId: item.dailySheetId,
                dailySheetItemId: item.id,
                filledDropped: item.filledDropped,
                emptyReceived: item.emptyReceived,
                filledReceived: item.filledReceived,
                cashCollected: item.cashCollected,
                pricePerBottle: dto.newPricePerBottle,
                occurredAt: item.sheetDate,
              },
              tx,
            );
          } catch (e) {
            if (e instanceof BadRequestException && /negative/i.test((e as Error).message)) {
              throw new UnprocessableEntityException({
                code: 'BULK_REPRICE_WALLET_NEGATIVE',
                message:
                  'This repricing would make the customer’s bottle wallet negative. Resolve the bottle balance first.',
              });
            }
            throw e;
          }

          // Read via `tx` — the ledger just wrote the new balance on this same
          // connection; the outer client can't see the uncommitted write.
          const updatedCustomer = await tx.customer.findUnique({
            where: { id: customerId },
            select: { financialBalance: true },
          });

          await tx.dailySheetItem.update({
            where: { id: item.id },
            data: {
              pricePerBottle: dto.newPricePerBottle,
              isRepriced: true,
              repricedAt: now,
              editCount: { increment: 1 },
              lastEditedAt: now,
              financialBalanceAfter: updatedCustomer?.financialBalance ?? null,
            },
          });

          await tx.deliveryRepricingItem.create({
            data: {
              batchId: batch.id,
              dailySheetItemId: item.id,
              dailySheetId: item.dailySheetId,
              quantity: item.filledDropped,
              oldPricePerBottle,
              newPricePerBottle: dto.newPricePerBottle,
              oldAmount,
              newAmount,
              difference,
            },
          });

          totalDifference += difference;
          touchedSheetDates.add(item.sheetDate.toISOString().slice(0, 10));
          itemResults.push({
            dailySheetItemId: item.id,
            oldPricePerBottle,
            newPricePerBottle: dto.newPricePerBottle,
            oldAmount,
            newAmount,
            difference,
          });
        }

        const updatedBatch = await tx.deliveryRepricingBatch.update({
          where: { id: batch.id },
          data: { totalDifference },
        });

        return { batch: updatedBatch, items: itemResults };
      },
      { timeout: 30000, maxWait: 5000 },
    );

    await this.audit.log({
      vendorId,
      userId: user.userId,
      userName: user.name,
      action: 'BULK_CLOSED_DELIVERY_REPRICED',
      entity: 'DeliveryRepricingBatch',
      entityId: result.batch.id,
      changes: {
        after: {
          customerId,
          newPricePerBottle: dto.newPricePerBottle,
          reason: dto.reason,
          itemCount: result.items.length,
          totalDifference: result.batch.totalDifference,
          items: result.items,
        },
      },
    });

    await Promise.all([
      ...Array.from(touchedSheetDates).map((date) => this.cache.invalidateDailyDashboard(vendorId, date)),
      this.cache.invalidateOverview(vendorId),
      this.cache.invalidateAnalytics(vendorId),
    ]);

    return {
      batchId: result.batch.id,
      customerId,
      itemCount: result.items.length,
      totalDifference: result.batch.totalDifference,
      items: result.items,
    };
  }
}
