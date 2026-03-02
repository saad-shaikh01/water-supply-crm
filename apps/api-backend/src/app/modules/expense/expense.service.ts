import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { TransactionType } from '@prisma/client';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';
import { ExpenseQueryDto } from './dto/expense-query.dto';
import { paginate } from '../../common/helpers/paginate';

@Injectable()
export class ExpenseService {
  constructor(private prisma: PrismaService) {}

  async create(vendorId: string, createdById: string, dto: CreateExpenseDto) {
    return this.prisma.expense.create({
      data: {
        vendorId,
        createdById,
        category: dto.category,
        amount: dto.amount,
        description: dto.description,
        date: new Date(dto.date),
        vanId: dto.vanId ?? null,
      },
      include: {
        van: { select: { id: true, plateNumber: true } },
        createdBy: { select: { id: true, name: true } },
      },
    });
  }

  async findAll(vendorId: string, query: ExpenseQueryDto) {
    const { page = 1, limit = 20, category, from, to, vanId } = query;

    const where: any = { vendorId };
    if (category) where.category = category;
    if (vanId) where.vanId = vanId;
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

    return this.prisma.expense.update({
      where: { id },
      data: {
        ...(dto.category !== undefined && { category: dto.category }),
        ...(dto.amount !== undefined && { amount: dto.amount }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.date !== undefined && { date: new Date(dto.date as string) }),
        ...(dto.vanId !== undefined && { vanId: dto.vanId || null }),
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
    await this.prisma.expense.delete({ where: { id } });
    return { deleted: true };
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
