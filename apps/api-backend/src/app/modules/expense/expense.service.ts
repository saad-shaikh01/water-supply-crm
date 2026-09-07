import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { CacheInvalidationService } from '@water-supply-crm/caching';
import { TransactionType } from '@prisma/client';
import type { AuthUser } from '@water-supply-crm/types';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';
import { ExpenseQueryDto } from './dto/expense-query.dto';
import { CorrectClosedExpenseDto } from './dto/correct-closed-expense.dto';
import { VoidClosedExpenseDto } from './dto/void-closed-expense.dto';
import { AddClosedExpenseDto } from './dto/add-closed-expense.dto';
import { AuditService } from '../audit/audit.service';
import { paginate } from '../../common/helpers/paginate';

@Injectable()
export class ExpenseService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private cache: CacheInvalidationService,
  ) {}

  async create(vendorId: string, createdById: string, dto: CreateExpenseDto) {
    // Vendor-scoped ownership checks — same pattern as FuelLogService.create,
    // so an unknown/foreign vanId or dailySheetId 404s instead of falling
    // through to an unhandled FK-constraint error from the insert below.
    if (dto.vanId) {
      const van = await this.prisma.van.findFirst({ where: { id: dto.vanId, vendorId } });
      if (!van) throw new NotFoundException('Vehicle not found');
    }

    // Trip feature: an expense recorded against a sheet is attributed to
    // whichever trip is currently active on it (null if none active) — not
    // exposed as an API param, purely inferred server-side so callers never
    // have to know/pick a trip.
    let dailySheetLoadId: string | null = null;
    if (dto.dailySheetId) {
      const sheet = await this.prisma.dailySheet.findFirst({
        where: { id: dto.dailySheetId, vendorId },
        select: { isClosed: true },
      });
      if (!sheet) throw new NotFoundException('Daily sheet not found');
      // Same closed-sheet business rule already enforced by
      // CrewCashDistributionService.create — an Expense is a financial
      // record too and must not be added after the sheet is finalized.
      // Post-Close Expense Correction: adding an expense onto a closed sheet
      // now goes through POST /expenses/closed (createClosed) instead.
      if (sheet.isClosed) {
        throw new BadRequestException('Cannot record an Expense against a closed daily sheet.');
      }

      const activeLoad = await this.prisma.dailySheetLoad.findFirst({
        where: { dailySheetId: dto.dailySheetId, endedAt: null },
      });
      dailySheetLoadId = activeLoad?.id ?? null;
    }

    return this.prisma.expense.create({
      data: {
        vendorId,
        createdById,
        category: dto.category,
        amount: dto.amount,
        paidFromCash: dto.paidFromCash ?? true,
        description: dto.description,
        date: new Date(dto.date),
        vanId: dto.vanId ?? null,
        dailySheetId: dto.dailySheetId ?? null,
        dailySheetLoadId,
      },
      include: {
        van: { select: { id: true, plateNumber: true } },
        createdBy: { select: { id: true, name: true } },
      },
    });
  }

  async findAll(vendorId: string, query: ExpenseQueryDto) {
    const { page = 1, limit = 20, category, from, to, vanId, dailySheetId } = query;

    const where: any = { vendorId };
    if (category) where.category = category;
    if (vanId) where.vanId = vanId;
    if (dailySheetId) where.dailySheetId = dailySheetId;
    if (from || to) {
      where.date = {};
      if (from) where.date.gte = new Date(from);
      if (to) {
        const end = new Date(to);
        end.setHours(23, 59, 59, 999);
        where.date.lte = end;
      }
    }

    const [data, total] = await Promise.all([
      this.prisma.expense.findMany({
        where,
        include: {
          van: { select: { id: true, plateNumber: true } },
          createdBy: { select: { id: true, name: true } },
        },
        orderBy: { date: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.expense.count({ where }),
    ]);

    return paginate(data, total, page, limit);
  }

  async findOne(vendorId: string, id: string) {
    const expense = await this.prisma.expense.findFirst({
      where: { id, vendorId },
      include: {
        van: { select: { id: true, plateNumber: true } },
        createdBy: { select: { id: true, name: true } },
      },
    });
    if (!expense) throw new NotFoundException('Expense not found');
    return expense;
  }

  async update(vendorId: string, id: string, dto: UpdateExpenseDto) {
    const expense = await this.prisma.expense.findFirst({ where: { id, vendorId } });
    if (!expense) throw new NotFoundException('Expense not found');

    // Post-Close Expense Correction: a closed-sheet expense must now go through
    // the dedicated PATCH /expenses/:id/correct endpoint (row-locked, audited,
    // marker-bumped). This closes the latent hole where the plain update path
    // silently mutated a finalized sheet's expense figures.
    if (expense.dailySheetId) {
      const sheet = await this.prisma.dailySheet.findFirst({
        where: { id: expense.dailySheetId },
        select: { isClosed: true },
      });
      if (sheet?.isClosed) {
        throw new ConflictException(
          'This expense is on a closed sheet — use the closed-sheet correction action.',
        );
      }
    }

    return this.prisma.expense.update({
      where: { id },
      data: {
        ...(dto.category !== undefined && { category: dto.category }),
        ...(dto.amount !== undefined && { amount: dto.amount }),
        ...(dto.paidFromCash !== undefined && { paidFromCash: dto.paidFromCash }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.date !== undefined && { date: new Date(dto.date as string) }),
        ...(dto.vanId !== undefined && { vanId: dto.vanId || null }),
        ...(dto.dailySheetId !== undefined && { dailySheetId: dto.dailySheetId || null }),
      },
      include: {
        van: { select: { id: true, plateNumber: true } },
        createdBy: { select: { id: true, name: true } },
      },
    });
  }

  async remove(vendorId: string, id: string) {
    const expense = await this.prisma.expense.findFirst({ where: { id, vendorId } });
    if (!expense) throw new NotFoundException('Expense not found');

    // Post-Close Expense Correction — see update() above. A closed-sheet
    // expense is deleted through POST /expenses/:id/void (voidClosed).
    if (expense.dailySheetId) {
      const sheet = await this.prisma.dailySheet.findFirst({
        where: { id: expense.dailySheetId },
        select: { isClosed: true },
      });
      if (sheet?.isClosed) {
        throw new ConflictException(
          'This expense is on a closed sheet — use the closed-sheet correction action.',
        );
      }
    }

    await this.prisma.expense.delete({ where: { id } });
    return { deleted: true };
  }

  // ── Post-Close Expense Correction ───────────────────────────────────────
  // Three dedicated endpoints (edit / hard-delete / add) for Expense rows on an
  // ALREADY-CLOSED daily sheet, mirroring the daily-sheet siblings
  // correctClosedTrip / correctClosedDelivery / voidDelivery.
  //
  // ACCEPTED DIVERGENCE (identical to those siblings): these methods never
  // re-run buildReconciliation / createCasesForSheet and never rewrite the
  // frozen close-time DailySheet.cashExpected / cashCollected columns. The
  // post-close divergence banner and the hybrid cash rollups (dashboard /
  // analytics / driver stats) surface the drift instead, keyed off the
  // DailySheet.postCloseExpenseCorrectionCount marker each call increments.
  // See docs/features/post-close-expense-correction.md.

  /** Load a closed-sheet expense and run the shared guards (404 / not-closed /
   *  linked-record). Returns the expense with its dailySheet {id,isClosed,date}. */
  private async loadClosedExpenseForCorrection(vendorId: string, id: string) {
    const expense = await this.prisma.expense.findFirst({
      where: { id, vendorId },
      include: {
        dailySheet: { select: { id: true, isClosed: true, date: true } },
        fuelLog: { select: { id: true } },
        vehicleServiceRecord: { select: { id: true } },
        discrepancyCase: { select: { id: true } },
      },
    });
    if (!expense) throw new NotFoundException('Expense not found');
    if (!expense.dailySheetId || !expense.dailySheet?.isClosed) {
      throw new ConflictException(
        'This expense is not on a closed sheet — use the normal edit/delete action.',
      );
    }
    if (expense.fuelLog || expense.vehicleServiceRecord || expense.discrepancyCase) {
      throw new ConflictException(
        'This expense is linked to a Fuel Log / service / discrepancy record — cannot be corrected here.',
      );
    }
    return expense;
  }

  async correctClosed(user: AuthUser, id: string, dto: CorrectClosedExpenseDto) {
    const vendorId = user.vendorId;
    const expense = await this.loadClosedExpenseForCorrection(vendorId, id);
    const dailySheetId = expense.dailySheetId as string;

    if (dto.vanId) {
      const van = await this.prisma.van.findFirst({ where: { id: dto.vanId, vendorId } });
      if (!van) throw new NotFoundException('Vehicle not found');
    }

    // Only the fields the caller actually sent are applied.
    const appliedFields: Record<string, unknown> = {};
    if (dto.amount !== undefined) appliedFields.amount = dto.amount;
    if (dto.category !== undefined) appliedFields.category = dto.category;
    if (dto.description !== undefined) appliedFields.description = dto.description;
    if (dto.date !== undefined) appliedFields.date = new Date(dto.date);
    if (dto.paidFromCash !== undefined) appliedFields.paidFromCash = dto.paidFromCash;
    if (dto.vanId !== undefined) appliedFields.vanId = dto.vanId || null;

    const before = {
      amount: expense.amount,
      category: expense.category,
      description: expense.description,
      date: expense.date,
      paidFromCash: expense.paidFromCash,
      vanId: expense.vanId,
      dailySheetId: expense.dailySheetId,
    };

    const updated = await this.prisma.$transaction(async (tx) => {
      // Row-lock the Expense FIRST (mirror correctClosedTrip) — serialises
      // concurrent corrections/voids of the same row so the in-txn re-read
      // below sees the prior writer's COMMITTED state, never a stale snapshot.
      // Expense.id is a text column — bound as a tagged-template parameter.
      await tx.$queryRaw`SELECT 1 FROM "Expense" WHERE id = ${id} FOR UPDATE`;

      const fresh = await tx.expense.findUnique({
        where: { id },
        select: { id: true, dailySheetId: true, dailySheet: { select: { isClosed: true } } },
      });
      if (!fresh || !fresh.dailySheetId || !fresh.dailySheet?.isClosed) {
        throw new ConflictException('This expense is no longer on a closed sheet.');
      }

      const row = await tx.expense.update({
        where: { id },
        data: appliedFields,
        include: {
          van: { select: { id: true, plateNumber: true } },
          createdBy: { select: { id: true, name: true } },
        },
      });

      await tx.dailySheet.update({
        where: { id: dailySheetId },
        data: { postCloseExpenseCorrectionCount: { increment: 1 } },
      });

      return row;
    });

    await this.audit.log({
      vendorId,
      userId: user.userId,
      userName: user.name,
      action: 'CLOSED_EXPENSE_CORRECTED',
      entity: 'Expense',
      entityId: id,
      changes: {
        before,
        after: { ...before, ...appliedFields, correctionNote: dto.correctionNote },
      },
    });

    await this.invalidateSheetRollups(vendorId, expense.dailySheet?.date);

    return updated;
  }

  async voidClosed(user: AuthUser, id: string, dto: VoidClosedExpenseDto) {
    const vendorId = user.vendorId;
    const expense = await this.loadClosedExpenseForCorrection(vendorId, id);
    const dailySheetId = expense.dailySheetId as string;

    // Hard delete — the audit `before` block below is the only surviving record.
    const before = {
      id: expense.id,
      vendorId: expense.vendorId,
      createdById: expense.createdById,
      category: expense.category,
      amount: expense.amount,
      paidFromCash: expense.paidFromCash,
      description: expense.description,
      date: expense.date,
      vanId: expense.vanId,
      dailySheetId: expense.dailySheetId,
      dailySheetLoadId: expense.dailySheetLoadId,
      createdAt: expense.createdAt,
    };

    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM "Expense" WHERE id = ${id} FOR UPDATE`;

      const fresh = await tx.expense.findUnique({
        where: { id },
        select: { id: true, dailySheetId: true, dailySheet: { select: { isClosed: true } } },
      });
      if (!fresh || !fresh.dailySheetId || !fresh.dailySheet?.isClosed) {
        throw new ConflictException('This expense is no longer on a closed sheet.');
      }

      await tx.expense.delete({ where: { id } });
      await tx.dailySheet.update({
        where: { id: dailySheetId },
        data: { postCloseExpenseCorrectionCount: { increment: 1 } },
      });
    });

    await this.audit.log({
      vendorId,
      userId: user.userId,
      userName: user.name,
      action: 'CLOSED_EXPENSE_VOIDED',
      entity: 'Expense',
      entityId: id,
      changes: {
        before: { ...before, correctionNote: dto.correctionNote },
      },
    });

    await this.invalidateSheetRollups(vendorId, expense.dailySheet?.date);

    return { deleted: true };
  }

  async createClosed(user: AuthUser, dto: AddClosedExpenseDto) {
    const vendorId = user.vendorId;

    if (dto.vanId) {
      const van = await this.prisma.van.findFirst({ where: { id: dto.vanId, vendorId } });
      if (!van) throw new NotFoundException('Vehicle not found');
    }

    const sheet = await this.prisma.dailySheet.findFirst({
      where: { id: dto.dailySheetId, vendorId },
      select: { id: true, isClosed: true, date: true },
    });
    if (!sheet) throw new NotFoundException('Daily sheet not found');
    if (!sheet.isClosed) {
      throw new ConflictException('Sheet is not closed — use the normal add-expense flow.');
    }

    // Attribute to the sheet's last-ended trip (a closed sheet has no active
    // trip), same "inferred server-side, never an API param" approach as
    // create(); null if the sheet had no trips.
    const lastTrip = await this.prisma.dailySheetLoad.findFirst({
      where: { dailySheetId: dto.dailySheetId, endedAt: { not: null } },
      orderBy: { endedAt: 'desc' },
      select: { id: true },
    });
    const dailySheetLoadId = lastTrip?.id ?? null;

    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.expense.create({
        data: {
          vendorId,
          createdById: user.userId,
          category: dto.category,
          amount: dto.amount,
          paidFromCash: dto.paidFromCash ?? true,
          description: dto.description,
          date: new Date(dto.date),
          vanId: dto.vanId ?? null,
          dailySheetId: dto.dailySheetId,
          dailySheetLoadId,
        },
        include: {
          van: { select: { id: true, plateNumber: true } },
          createdBy: { select: { id: true, name: true } },
        },
      });

      await tx.dailySheet.update({
        where: { id: dto.dailySheetId },
        data: { postCloseExpenseCorrectionCount: { increment: 1 } },
      });

      return row;
    });

    await this.audit.log({
      vendorId,
      userId: user.userId,
      userName: user.name,
      action: 'CLOSED_EXPENSE_ADDED',
      entity: 'Expense',
      entityId: created.id,
      changes: {
        after: { ...dto, correctionNote: dto.correctionNote },
      },
    });

    await this.invalidateSheetRollups(vendorId, sheet.date);

    return created;
  }

  /** 3-way cache fan-out shared by the closed-sheet correction endpoints —
   *  identical to the daily-sheet siblings' post-commit invalidation. */
  private async invalidateSheetRollups(vendorId: string, sheetDate?: Date | null) {
    const dateStr = sheetDate ? new Date(sheetDate).toISOString().slice(0, 10) : undefined;
    await Promise.all([
      this.cache.invalidateDailyDashboard(vendorId, dateStr),
      this.cache.invalidateOverview(vendorId),
      this.cache.invalidateAnalytics(vendorId),
    ]);
  }

  async getSummary(vendorId: string, from?: string, to?: string) {
    const expenseWhere: any = { vendorId };
    const txWhere: any = { vendorId, type: TransactionType.DELIVERY };

    if (from || to) {
      const dateFilter: any = {};
      if (from) dateFilter.gte = new Date(from);
      if (to) {
        const end = new Date(to);
        end.setHours(23, 59, 59, 999);
        dateFilter.lte = end;
      }
      expenseWhere.date = dateFilter;
      txWhere.createdAt = dateFilter;
    }

    const [expenses, revenueAgg] = await Promise.all([
      this.prisma.expense.groupBy({
        by: ['category'],
        where: expenseWhere,
        _sum: { amount: true },
        _count: { id: true },
      }),
      this.prisma.transaction.aggregate({
        where: txWhere,
        _sum: { amount: true },
      }),
    ]);

    const breakdown = expenses.map((e) => ({
      category: e.category,
      totalAmount: e._sum.amount ?? 0,
      count: e._count.id,
    }));

    const grandTotal = breakdown.reduce((sum, b) => sum + b.totalAmount, 0);
    const totalRevenue = revenueAgg._sum.amount ?? 0;

    return {
      breakdown,
      grandTotal,
      totalRevenue,
      grossProfit: totalRevenue - grandTotal,
    };
  }
}
