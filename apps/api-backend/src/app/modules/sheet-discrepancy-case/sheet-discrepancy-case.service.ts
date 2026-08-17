import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import {
  DiscrepancyCaseStatus,
  DiscrepancyResolutionType,
  DiscrepancyType,
  ExpenseCategory,
  Prisma,
  StaffLedgerCategory,
  UserRole,
} from '@prisma/client';
import type { AuthUser } from '@water-supply-crm/types';
import { paginate } from '../../common/helpers/paginate';
import { StaffLedgerService } from '../payroll/staff-ledger.service';
import { ResolveDiscrepancyCaseDto } from './dto/resolve-discrepancy-case.dto';
import { DiscrepancyCaseQueryDto } from './dto/discrepancy-case-query.dto';

/**
 * Narrow shape of `DailySheetService.buildReconciliation()`'s return value —
 * only the three discrepancy figures this service actually reads. Kept as a
 * separate interface (not importing the full return type) so this module has
 * no compile-time dependency on DailySheetService's private method shape.
 */
export interface DiscrepancySourceReconciliation {
  bottles: { discrepancy: number };
  empties: { discrepancy: number };
  driver: { unexplainedDiscrepancy: number };
}

/**
 * Sheet Discrepancy Case — bottle/empty/cash reconciliation gaps auto-detected
 * by `DailySheetService.closeSheet()` (one row per non-zero discrepancy type,
 * up to 3 per close — no auto-waive threshold, every non-zero gap gets a
 * case) that STAFF/VENDOR_ADMIN must explicitly resolve. Two-state lifecycle
 * (REPORTED → RESOLVED, no UNDER_REVIEW step — unlike DamageCase, these are
 * already staff/system-detected at close time, so resolution is the only
 * staff-initiated step).
 *
 * Resolution moves money via two already-proven primitives, never new ones:
 *   - CHARGED_TO_DRIVER → StaffLedgerService.createTx (category PENALTY,
 *     already flows into PayrollEntry's dedicated `penalties` bucket).
 *   - COMPANY_LOSS → a raw tx.expense.create (category DISCREPANCY_WRITE_OFF,
 *     paidFromCash: false — never touched driver cash) — bypasses
 *     ExpenseService's closed-sheet gate on purpose, same precedent as
 *     FuelLogService/VehicleMaintenanceService writing Expense rows directly
 *     for system-generated entries rather than user-typed ones.
 *   - WAIVED → no money moves, just a logged reason (required — the only
 *     signal here that a genuine decision was made, since there's no
 *     photo/wallet-balance gate the way DamageCase has).
 */
@Injectable()
export class SheetDiscrepancyCaseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly staffLedger: StaffLedgerService,
  ) {}

  /**
   * Creates one REPORTED case per non-zero discrepancy type found in
   * `reconciliation`. Called from inside `DailySheetService.closeSheet()`'s
   * own transaction — tx-parameterized exactly like
   * `CrewCashDistributionService.syncSheetToLedger`, so a failure here rolls
   * back the isClosed flip too (all-or-nothing).
   */
  async createCasesForSheet(
    tx: Prisma.TransactionClient,
    vendorId: string,
    sheet: { id: string; driverId: string },
    reconciliation: DiscrepancySourceReconciliation,
    actorId: string,
    actorRole: UserRole,
  ): Promise<{ createdCount: number; types: DiscrepancyType[] }> {
    const candidates: {
      type: DiscrepancyType;
      magnitude: number;
      reportedQuantity: number | null;
      reportedAmount: number | null;
    }[] = [
      {
        type: DiscrepancyType.BOTTLE,
        magnitude: reconciliation.bottles.discrepancy,
        reportedQuantity: reconciliation.bottles.discrepancy,
        reportedAmount: null,
      },
      {
        type: DiscrepancyType.EMPTY,
        magnitude: reconciliation.empties.discrepancy,
        reportedQuantity: reconciliation.empties.discrepancy,
        reportedAmount: null,
      },
      {
        type: DiscrepancyType.CASH,
        magnitude: reconciliation.driver.unexplainedDiscrepancy,
        reportedQuantity: null,
        reportedAmount: reconciliation.driver.unexplainedDiscrepancy,
      },
    ];

    const types: DiscrepancyType[] = [];
    for (const c of candidates) {
      if (c.magnitude === 0) continue;

      const kase = await tx.sheetDiscrepancyCase.create({
        data: {
          vendorId,
          dailySheetId: sheet.id,
          driverId: sheet.driverId,
          type: c.type,
          reportedQuantity: c.reportedQuantity,
          reportedAmount: c.reportedAmount,
        },
      });

      await tx.sheetDiscrepancyCaseAuditLog.create({
        data: {
          discrepancyCaseId: kase.id,
          actorId,
          actorRole,
          action: 'CREATED',
          payload: { type: c.type, reportedQuantity: c.reportedQuantity, reportedAmount: c.reportedAmount },
        },
      });

      types.push(c.type);
    }

    return { createdCount: types.length, types };
  }

  async findAll(user: AuthUser, query: DiscrepancyCaseQueryDto) {
    const { page = 1, limit = 20, status, type, driverId, vanId, dailySheetId, dateFrom, dateTo } = query;

    const where: Prisma.SheetDiscrepancyCaseWhereInput = { vendorId: user.vendorId };
    if (status) where.status = status;
    if (type) where.type = type;
    if (driverId) where.driverId = driverId;
    if (dailySheetId) where.dailySheetId = dailySheetId;
    if (vanId) where.dailySheet = { vanId };
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = new Date(dateFrom);
      if (dateTo) {
        const end = new Date(dateTo);
        end.setHours(23, 59, 59, 999);
        where.createdAt.lte = end;
      }
    }

    const [data, total] = await Promise.all([
      this.prisma.sheetDiscrepancyCase.findMany({
        where,
        include: {
          driver: { select: { id: true, name: true } },
          resolvedBy: { select: { id: true, name: true } },
          dailySheet: { select: { id: true, date: true, van: { select: { id: true, plateNumber: true } } } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.sheetDiscrepancyCase.count({ where }),
    ]);

    return paginate(data, total, page, limit);
  }

  async findOne(user: AuthUser, id: string) {
    const kase = await this.prisma.sheetDiscrepancyCase.findFirst({
      where: { id, vendorId: user.vendorId },
      include: {
        driver: { select: { id: true, name: true } },
        resolvedBy: { select: { id: true, name: true } },
        dailySheet: { select: { id: true, date: true, van: { select: { id: true, plateNumber: true } } } },
      },
    });
    if (!kase) throw new NotFoundException('Discrepancy case not found.');
    return kase;
  }

  async getAuditLog(user: AuthUser, id: string) {
    const kase = await this.prisma.sheetDiscrepancyCase.findFirst({
      where: { id, vendorId: user.vendorId },
      select: { id: true },
    });
    if (!kase) throw new NotFoundException('Discrepancy case not found.');

    return this.prisma.sheetDiscrepancyCaseAuditLog.findMany({
      where: { discrepancyCaseId: id },
      orderBy: { createdAt: 'asc' },
    });
  }

  async resolve(user: AuthUser, id: string, dto: ResolveDiscrepancyCaseDto) {
    if (dto.resolutionType === DiscrepancyResolutionType.WAIVED && !dto.resolutionNote?.trim()) {
      throw new BadRequestException('A reason is required to waive a discrepancy case.');
    }

    return this.prisma.$transaction(async (tx) => {
      const kase = await tx.sheetDiscrepancyCase.findFirst({ where: { id, vendorId: user.vendorId } });
      if (!kase) throw new NotFoundException('Discrepancy case not found.');
      if (kase.status !== DiscrepancyCaseStatus.REPORTED) {
        throw new BadRequestException('Only REPORTED cases can be resolved.');
      }

      let staffLedgerEntryId: string | null = null;
      let expenseId: string | null = null;

      if (dto.resolutionType === DiscrepancyResolutionType.CHARGED_TO_DRIVER) {
        const entry = await this.staffLedger.createTx(tx, user, {
          userId: kase.driverId,
          category: StaffLedgerCategory.PENALTY,
          amount: -Math.round(dto.resolutionAmount as number),
          effectiveDate: new Date().toISOString(),
          description: `Sheet discrepancy (${kase.type}) — case ${id}${dto.resolutionNote ? `: ${dto.resolutionNote}` : ''}`,
        });
        staffLedgerEntryId = entry.id;
      } else if (dto.resolutionType === DiscrepancyResolutionType.COMPANY_LOSS) {
        const expense = await tx.expense.create({
          data: {
            vendorId: user.vendorId,
            category: ExpenseCategory.DISCREPANCY_WRITE_OFF,
            amount: dto.resolutionAmount as number,
            paidFromCash: false,
            description: `Sheet discrepancy write-off (${kase.type}) — case ${id}${dto.resolutionNote ? `: ${dto.resolutionNote}` : ''}`,
            date: new Date(),
            dailySheetId: kase.dailySheetId,
            createdById: user.userId,
          },
        });
        expenseId = expense.id;
      }
      // WAIVED: no downstream row.

      // Atomic CAS — the WHERE clause itself enforces the version match at
      // the database level (StaffLedgerService/CrewCashDistributionService
      // idiom), not DamageCase's weaker read-then-compare. A lost race here
      // rolls back the whole transaction, so no StaffLedgerEntry/Expense row
      // written above ever survives orphaned.
      const claim = await tx.sheetDiscrepancyCase.updateMany({
        where: { id, vendorId: user.vendorId, version: dto.version },
        data: {
          status: DiscrepancyCaseStatus.RESOLVED,
          resolutionType: dto.resolutionType,
          resolutionAmount: dto.resolutionType === DiscrepancyResolutionType.WAIVED ? null : dto.resolutionAmount,
          resolutionNote: dto.resolutionNote ?? null,
          resolvedById: user.userId,
          resolvedAt: new Date(),
          staffLedgerEntryId,
          expenseId,
          version: { increment: 1 },
        },
      });
      if (claim.count === 0) {
        throw new ConflictException(
          `Version mismatch: expected ${kase.version}, received ${dto.version}. Reload and retry.`,
        );
      }

      await tx.sheetDiscrepancyCaseAuditLog.create({
        data: {
          discrepancyCaseId: id,
          actorId: user.userId,
          actorRole: user.role,
          action: 'RESOLVED',
          payload: {
            resolutionType: dto.resolutionType,
            resolutionAmount: dto.resolutionAmount ?? null,
            resolutionNote: dto.resolutionNote ?? null,
            staffLedgerEntryId,
            expenseId,
          },
        },
      });

      return tx.sheetDiscrepancyCase.findUniqueOrThrow({ where: { id } });
    });
  }
}
