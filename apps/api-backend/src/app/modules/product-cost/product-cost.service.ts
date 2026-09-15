import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import type { AuthUser } from '@water-supply-crm/types';
import { Prisma, ProductCostSource } from '@prisma/client';
import { CreateProductCostDto } from './dto/create-product-cost.dto';
import { EditProductCostDto } from './dto/edit-product-cost.dto';
import { VoidProductCostDto } from './dto/void-product-cost.dto';

/**
 * Historical Product Cost & COGS — the versioned, effective-dated plant cost
 * per product (docs/features/product-cost-history-and-cogs.md §4). Mirrors
 * SalaryStructureService's shape, generalized to also support a true
 * backdated insert that splits/trims an existing range (§4.1), a narrow
 * Controlled Edit limited to `costPerUnit` (§4.4), and Void of the current
 * row only (§4.3). Every mutation writes an AuditLog row
 * (`entity: 'ProductCost'`) inside the same transaction as the data change.
 */
@Injectable()
export class ProductCostService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Add a new cost row (design doc §4.1). Handles both the routine
   * forward-dated new-rate case and a true backdated correction that splits
   * an existing range — see the inline steps below, numbered to match the
   * design doc's algorithm.
   */
  async create(user: AuthUser, dto: CreateProductCostDto) {
    await this.assertProductInVendor(user.vendorId, dto.productId);

    const effectiveFrom = new Date(dto.effectiveFrom);
    const note = dto.note?.trim() || undefined;

    return this.prisma.$transaction(async (tx) => {
      // Step 1: find the row (if any) whose range currently covers `effectiveFrom`.
      const covering = await tx.productCost.findFirst({
        where: {
          vendorId: user.vendorId,
          productId: dto.productId,
          voidedAt: null,
          effectiveFrom: { lte: effectiveFrom },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: effectiveFrom } }],
        },
      });

      let newEffectiveTo: Date | null;

      if (covering) {
        if (covering.effectiveFrom.getTime() === effectiveFrom.getTime()) {
          // Step 3: duplicate-date conflict — not a valid insert.
          const suggestion =
            covering.effectiveTo === null
              ? 'Void that entry (§4.3) and re-add it with the corrected value.'
              : `Row ${covering.id} already has this exact effective date and has since been superseded — it can no longer be voided (only the current row is voidable). Use Controlled Edit if it has zero recorded deliveries, or insert a new backdated row for the affected sub-range instead.`;
          throw new ConflictException(
            `A cost row already exists for this product effective ${dto.effectiveFrom}. ${suggestion}`,
          );
        }

        // Step 4: trims the covering row and inherits its original (pre-trim)
        // effectiveTo for the new row. This covers two different real-world
        // cases that both happen to hit the same code path (a covering row
        // always exists once ANY history exists, since "today" itself falls
        // inside the current open row's range):
        //   - a routine forward-dated rate change (effectiveFrom is today or
        //     in the future) — the ordinary "the plant is raising the price
        //     starting now/next week" action, not a correction to anything;
        //   - a true backdated correction (effectiveFrom is before today) —
        //     rewriting what applied during a period that has already
        //     elapsed, which is the case the mandatory-reason rule exists
        //     for (2026-09-15 polish: narrowed from "any trim" to just this
        //     one, per owner feedback that routine forward changes shouldn't
        //     need a reason).
        const startOfTodayUtc = new Date();
        startOfTodayUtc.setUTCHours(0, 0, 0, 0);
        const isBackdated = effectiveFrom.getTime() < startOfTodayUtc.getTime();

        if (isBackdated && !note) {
          throw new BadRequestException(
            'A note is required when this insert backdates into (and splits) an existing cost row.',
          );
        }

        const originalEffectiveTo = covering.effectiveTo;
        const trimmedEffectiveTo = new Date(effectiveFrom);
        trimmedEffectiveTo.setUTCDate(trimmedEffectiveTo.getUTCDate() - 1);

        await tx.productCost.update({
          where: { id: covering.id },
          data: { effectiveTo: trimmedEffectiveTo },
        });

        await tx.auditLog.create({
          data: {
            vendorId: user.vendorId,
            userId: user.userId,
            userName: user.name,
            entity: 'ProductCost',
            entityId: covering.id,
            action: 'TRIM',
            changes: {
              before: { effectiveTo: originalEffectiveTo },
              after: { effectiveTo: trimmedEffectiveTo },
            } as Prisma.InputJsonValue,
          },
        });

        newEffectiveTo = originalEffectiveTo;
      } else {
        // Step 2: no covering row — first cost ever, or before-the-beginning
        // backdate. New row ends the day before the earliest existing row
        // (if any), or stays open (null) if the product has no history yet.
        const earliest = await tx.productCost.findFirst({
          where: { vendorId: user.vendorId, productId: dto.productId, voidedAt: null },
          orderBy: { effectiveFrom: 'asc' },
        });

        if (earliest) {
          const boundedTo = new Date(earliest.effectiveFrom);
          boundedTo.setUTCDate(boundedTo.getUTCDate() - 1);
          newEffectiveTo = boundedTo;
        } else {
          newEffectiveTo = null;
        }
      }

      const created = await tx.productCost.create({
        data: {
          vendorId: user.vendorId,
          productId: dto.productId,
          costPerUnit: dto.costPerUnit,
          effectiveFrom,
          effectiveTo: newEffectiveTo,
          note: note ?? null,
          invoiceRef: dto.invoiceRef ?? null,
          source: ProductCostSource.MANUAL,
          createdById: user.userId,
        },
      });

      await tx.auditLog.create({
        data: {
          vendorId: user.vendorId,
          userId: user.userId,
          userName: user.name,
          entity: 'ProductCost',
          entityId: created.id,
          action: 'CREATE',
          changes: {
            before: null,
            after: {
              costPerUnit: created.costPerUnit,
              effectiveFrom: created.effectiveFrom,
              effectiveTo: created.effectiveTo,
            },
          } as Prisma.InputJsonValue,
        },
      });

      return created;
    });
  }

  /**
   * Full cost history for a product, most-recent-`effectiveFrom`-first.
   * Voided rows are included (never hard-deleted) — the UI shows them
   * struck-through for audit continuity.
   *
   * Each row carries a computed `isEditable` flag (2026-09-15 polish, design
   * doc §4.4/§7.3) so the frontend can hide the Edit action proactively
   * instead of only discovering ineligibility from a 409 on submit. This
   * mirrors `editCostPerUnit`'s own eligibility rule exactly (zero non-voided
   * deliveries with `filledDropped > 0` anywhere in the row's effective
   * range) but fetches every relevant delivery date for the product ONCE —
   * not one `count()` per row — since a product's cost history is at most
   * tens of rows (design doc §3): an in-memory scan against one bulk-fetched
   * date list is cheap and avoids N+1 queries. `isEditable` is a live,
   * request-time computation (never cached/stored), same as
   * `editCostPerUnit`'s own check — a row can genuinely flip editable again
   * if the deliveries that once disqualified it are later voided.
   */
  async listHistory(user: AuthUser, productId: string) {
    await this.assertProductInVendor(user.vendorId, productId);

    const rows = await this.prisma.productCost.findMany({
      where: { vendorId: user.vendorId, productId },
      orderBy: { effectiveFrom: 'desc' },
    });

    const deliveryDates = (
      await this.prisma.dailySheetItem.findMany({
        where: {
          productId,
          status: { not: 'VOIDED' },
          filledDropped: { gt: 0 },
          dailySheet: { vendorId: user.vendorId },
        },
        select: { dailySheet: { select: { date: true } } },
      })
    ).map((r) => r.dailySheet.date.getTime());

    return rows.map((row) => {
      // A voided row is never editable (there's nothing to edit) regardless
      // of delivery history.
      if (row.voidedAt) return { ...row, isEditable: false };

      const fromMs = row.effectiveFrom.getTime();
      const rangeEndMs = (row.effectiveTo ?? new Date()).getTime();
      const hasDelivery = deliveryDates.some((d) => d >= fromMs && d <= rangeEndMs);
      return { ...row, isEditable: !hasDelivery };
    });
  }

  /**
   * Controlled Edit (design doc §4.4) — `costPerUnit` only; `effectiveFrom`/
   * `effectiveTo`/`productId` are never touched here. Allowed only while
   * zero non-voided deliveries with `filledDropped > 0` exist anywhere in
   * this row's effective range — checked live on every request, never
   * cached.
   */
  async editCostPerUnit(user: AuthUser, id: string, dto: EditProductCostDto) {
    const row = await this.prisma.productCost.findFirst({
      where: { id, vendorId: user.vendorId, voidedAt: null },
    });
    if (!row) throw new NotFoundException('Cost row not found.');

    const rangeEnd = row.effectiveTo ?? new Date();
    const deliveryCount = await this.prisma.dailySheetItem.count({
      where: {
        productId: row.productId,
        status: { not: 'VOIDED' },
        filledDropped: { gt: 0 },
        dailySheet: {
          vendorId: user.vendorId,
          date: row.effectiveTo === null ? { gte: row.effectiveFrom, lte: rangeEnd } : { gte: row.effectiveFrom, lt: rangeEnd },
        },
      },
    });

    if (deliveryCount > 0) {
      throw new ConflictException(
        `Cannot edit: ${deliveryCount} delivery record(s) already exist in this row's effective range. Use Add (a new backdated row, §4.1) to correct a period with real financial activity instead.`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const before = row.costPerUnit;

      // Only `costPerUnit` is ever mutated by Controlled Edit — the row's
      // original `note` (from creation) is left intact; the edit's mandatory
      // reason (`dto.note`) is captured in the AuditLog entry below instead.
      const updated = await tx.productCost.update({
        where: { id: row.id },
        data: { costPerUnit: dto.costPerUnit },
      });

      await tx.auditLog.create({
        data: {
          vendorId: user.vendorId,
          userId: user.userId,
          userName: user.name,
          entity: 'ProductCost',
          entityId: row.id,
          action: 'EDIT',
          changes: {
            before: { costPerUnit: before },
            after: { costPerUnit: dto.costPerUnit, reason: dto.note },
          } as Prisma.InputJsonValue,
        },
      });

      return updated;
    });
  }

  /**
   * Void (design doc §4.3) — only the current/latest, non-voided row for a
   * product may be voided. If this row had trimmed a predecessor when it
   * was created, that predecessor is reopened (`effectiveTo` reset to
   * null) — identified as the non-voided row with the next-lower
   * `effectiveFrom` for the same product, which by the maintained
   * contiguous-range invariant is guaranteed to be the trimmed one, if any.
   */
  async voidCurrentRow(user: AuthUser, id: string, dto: VoidProductCostDto) {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.productCost.findFirst({
        where: { id, vendorId: user.vendorId, voidedAt: null },
      });
      if (!row) throw new NotFoundException('Cost row not found.');

      if (row.effectiveTo !== null) {
        throw new BadRequestException(
          'Only the current (latest, open-ended) cost row may be voided. Historical rows are permanent once superseded.',
        );
      }

      // Belt-and-suspenders: confirm no other non-voided row for this
      // product has a later effectiveFrom (the invariant guarantees this
      // can't happen once effectiveTo === null, but verify rather than
      // assume).
      const laterRow = await tx.productCost.findFirst({
        where: {
          vendorId: user.vendorId,
          productId: row.productId,
          voidedAt: null,
          effectiveFrom: { gt: row.effectiveFrom },
        },
      });
      if (laterRow) {
        throw new BadRequestException('Only the current (latest) cost row may be voided.');
      }

      const predecessor = await tx.productCost.findFirst({
        where: {
          vendorId: user.vendorId,
          productId: row.productId,
          voidedAt: null,
          effectiveFrom: { lt: row.effectiveFrom },
        },
        orderBy: { effectiveFrom: 'desc' },
      });

      if (predecessor) {
        await tx.productCost.update({
          where: { id: predecessor.id },
          data: { effectiveTo: null },
        });
      }

      const voided = await tx.productCost.update({
        where: { id: row.id },
        data: {
          voidedAt: new Date(),
          voidedById: user.userId,
          voidReason: dto.voidReason,
        },
      });

      await tx.auditLog.create({
        data: {
          vendorId: user.vendorId,
          userId: user.userId,
          userName: user.name,
          entity: 'ProductCost',
          entityId: row.id,
          action: 'VOID',
          changes: {
            before: { voidedAt: null, effectiveTo: row.effectiveTo },
            after: {
              voidedAt: voided.voidedAt,
              voidReason: dto.voidReason,
              reopenedPredecessorId: predecessor?.id ?? null,
            },
          } as Prisma.InputJsonValue,
        },
      });

      return voided;
    });
  }

  private async assertProductInVendor(vendorId: string, productId: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, vendorId },
      select: { id: true },
    });
    if (!product) throw new NotFoundException('Product not found.');
  }
}
