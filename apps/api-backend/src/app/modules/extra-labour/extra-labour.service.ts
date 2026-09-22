import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import type { AuthUser } from '@water-supply-crm/types';
import { AuditService } from '../audit/audit.service';
import { normalizePhone } from '../whatsapp/phone.util';
import { vendorDateString, vendorDayStart } from '../../common/helpers/date.util';
import { CreateExtraLabourDto } from './dto/create-extra-labour.dto';
import { UpdateExtraLabourDto } from './dto/update-extra-labour.dto';
import { ExtraLabourQueryDto } from './dto/extra-labour-query.dto';
import { ExtraLabourPaymentsQueryDto } from './dto/extra-labour-payments-query.dto';

/**
 * PKT calendar-month bounds for "this month" figures (summary / profile KPIs).
 * Composed from the shared vendor-timezone helpers (never a hand-rolled UTC+5
 * offset — see date.util.ts's own note on why setHours()/raw offsets drift
 * from production, which runs in UTC).
 */
function getPktMonthRange(now: Date = new Date()): { start: Date; end: Date } {
  const [year, month] = vendorDateString(now).split('-').map(Number);
  const start = vendorDayStart(`${year}-${String(month).padStart(2, '0')}-01`);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const end = new Date(vendorDayStart(`${nextYear}-${String(nextMonth).padStart(2, '0')}-01`).getTime() - 1);
  return { start, end };
}

@Injectable()
export class ExtraLabourService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  /**
   * Picker options (Expense Form "Pay Extra Labour"). Active-only by default
   * (`onlyActive`), but `includeId` always resolves one specific row even
   * when it's since been deactivated — so editing an existing payment whose
   * labourer was deactivated afterwards still shows a real name in the
   * dropdown instead of going blank.
   */
  async getOptions(
    vendorId: string,
    search?: string,
    includeId?: string,
    labourTypeId?: string,
    onlyActive = true,
  ) {
    const digitsSearch = search ? search.replace(/\D/g, '') : '';
    const textSearch = search?.trim();

    const where: any = { vendorId };
    if (onlyActive) {
      where.OR = [{ isActive: true }, ...(includeId ? [{ id: includeId }] : [])];
    }
    if (labourTypeId) where.labourTypeId = labourTypeId;

    if (textSearch) {
      where.AND = [
        {
          OR: [
            { name: { contains: textSearch, mode: 'insensitive' } },
            ...(digitsSearch ? [{ phoneNumber: { contains: digitsSearch } }] : []),
            { labourType: { name: { contains: textSearch, mode: 'insensitive' } } },
          ],
        },
      ];
    }

    const items = await this.prisma.extraLabour.findMany({
      where,
      select: {
        id: true,
        name: true,
        phoneNumber: true,
        isActive: true,
        labourTypeId: true,
        labourType: { select: { name: true } },
      },
      orderBy: { name: 'asc' },
      take: 50,
    });

    return items.map((item) => ({
      id: item.id,
      name: item.name,
      phone: item.phoneNumber,
      isActive: item.isActive,
      labourTypeId: item.labourTypeId,
      labourTypeName: item.labourType.name,
    }));
  }

  async getSummary(vendorId: string) {
    const [activeCount, inactiveCount] = await Promise.all([
      this.prisma.extraLabour.count({ where: { vendorId, isActive: true } }),
      this.prisma.extraLabour.count({ where: { vendorId, isActive: false } }),
    ]);

    const { start, end } = getPktMonthRange();

    const [monthAggregate, totalAggregate] = await Promise.all([
      this.prisma.expense.aggregate({
        where: {
          vendorId,
          extraLabourId: { not: null },
          date: { gte: start, lte: end },
        },
        _sum: { amount: true },
      }),
      this.prisma.expense.aggregate({
        where: {
          vendorId,
          extraLabourId: { not: null },
        },
        _sum: { amount: true },
      }),
    ]);

    return {
      activeCount,
      inactiveCount,
      paidThisMonth: monthAggregate._sum.amount ?? 0,
      totalPaid: totalAggregate._sum.amount ?? 0,
    };
  }

  async listLabourers(vendorId: string, query: ExtraLabourQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: any = { vendorId };

    if (query.status === 'ACTIVE') {
      where.isActive = true;
    } else if (query.status === 'INACTIVE') {
      where.isActive = false;
    }

    if (query.labourTypeId) where.labourTypeId = query.labourTypeId;

    const textSearch = query.search?.trim();
    const digitsSearch = query.search ? query.search.replace(/\D/g, '') : '';

    if (textSearch) {
      where.OR = [
        { name: { contains: textSearch, mode: 'insensitive' } },
        ...(digitsSearch ? [{ phoneNumber: { contains: digitsSearch } }] : []),
        { labourType: { name: { contains: textSearch, mode: 'insensitive' } } },
      ];
    }

    const [total, items] = await Promise.all([
      this.prisma.extraLabour.count({ where }),
      this.prisma.extraLabour.findMany({
        where,
        include: {
          labourType: { select: { id: true, name: true } },
          createdBy: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    const itemIds = items.map((i) => i.id);

    const stats = itemIds.length > 0
      ? await this.prisma.expense.groupBy({
          by: ['extraLabourId'],
          where: {
            vendorId,
            extraLabourId: { in: itemIds },
          },
          _sum: { amount: true },
          _count: { _all: true },
          _max: { date: true },
        })
      : [];

    const statsMap = new Map(
      stats.map((s) => [
        s.extraLabourId,
        {
          totalPaid: s._sum.amount ?? 0,
          paymentCount: s._count._all,
          lastPaidAt: s._max.date,
        },
      ]),
    );

    const data = items.map((item) => {
      const itemStats = statsMap.get(item.id) ?? {
        totalPaid: 0,
        paymentCount: 0,
        lastPaidAt: null,
      };

      return {
        id: item.id,
        name: item.name,
        phone: item.phoneNumber,
        cnic: item.cnic,
        labourTypeId: item.labourTypeId,
        labourTypeName: item.labourType.name,
        notes: item.notes,
        isActive: item.isActive,
        createdBy: item.createdBy,
        totalPaid: itemStats.totalPaid,
        paymentsCount: itemStats.paymentCount,
        lastPaidAt: itemStats.lastPaidAt,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      };
    });

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async createLabourer(user: AuthUser, dto: CreateExtraLabourDto) {
    const type = await this.prisma.extraLabourType.findFirst({
      where: { id: dto.labourTypeId, vendorId: user.vendorId },
    });

    if (!type) {
      throw new NotFoundException('Extra labour type not found');
    }

    const rawPhone = dto.phone ?? dto.phoneNumber;
    const formattedPhone = rawPhone ? normalizePhone(rawPhone) : null;
    const isActive = dto.isActive !== undefined ? dto.isActive : true;
    const trimmedName = dto.name.trim();

    // Duplicates are never blocked (owner decision — multiple labourers may
    // legitimately share a phone, or none at all) — only surfaced as a
    // non-blocking warning so the recorder can double-check before saving.
    const [duplicatePhone, duplicateName] = await Promise.all([
      formattedPhone
        ? this.prisma.extraLabour.findFirst({
            where: { vendorId: user.vendorId, phoneNumber: formattedPhone, isActive: true },
          })
        : null,
      this.prisma.extraLabour.findFirst({
        where: { vendorId: user.vendorId, name: { equals: trimmedName, mode: 'insensitive' }, isActive: true },
      }),
    ]);

    const item = await this.prisma.extraLabour.create({
      data: {
        vendorId: user.vendorId,
        name: trimmedName,
        phoneNumber: formattedPhone,
        cnic: dto.cnic?.trim() || null,
        labourTypeId: dto.labourTypeId,
        notes: dto.notes?.trim() ?? null,
        isActive,
        createdById: user.userId,
      },
      include: {
        labourType: { select: { id: true, name: true } },
      },
    });

    await this.audit.log({
      vendorId: user.vendorId,
      userId: user.userId,
      userName: user.name,
      action: 'CREATED',
      entity: 'ExtraLabour',
      entityId: item.id,
      changes: { after: item },
    });

    const warnings: string[] = [];
    if (duplicatePhone) warnings.push('A labourer with this phone number already exists.');
    if (duplicateName) warnings.push(`A labourer named "${trimmedName}" already exists.`);

    return {
      data: this.toLabourerRecord(item),
      warnings,
    };
  }

  /** Shared flatten: DB row (+ its `labourType` relation) -> the wire shape every FE screen reads. */
  private toLabourerRecord(item: {
    id: string;
    name: string;
    phoneNumber: string | null;
    cnic: string | null;
    labourTypeId: string;
    labourType: { id: string; name: string };
    notes: string | null;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: item.id,
      name: item.name,
      phone: item.phoneNumber,
      cnic: item.cnic,
      labourTypeId: item.labourTypeId,
      labourTypeName: item.labourType.name,
      notes: item.notes,
      isActive: item.isActive,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }

  async getLabourerProfile(vendorId: string, id: string) {
    const item = await this.prisma.extraLabour.findFirst({
      where: { id, vendorId },
      include: {
        labourType: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
      },
    });

    if (!item) {
      throw new NotFoundException('Extra labourer not found');
    }

    const { start, end } = getPktMonthRange();

    const [overallAgg, monthAgg] = await Promise.all([
      this.prisma.expense.aggregate({
        where: { vendorId, extraLabourId: id },
        _sum: { amount: true },
        _count: { _all: true },
        _min: { date: true },
        _max: { date: true, amount: true },
        _avg: { amount: true },
      }),
      this.prisma.expense.aggregate({
        where: {
          vendorId,
          extraLabourId: id,
          date: { gte: start, lte: end },
        },
        _sum: { amount: true },
        _count: { _all: true },
      }),
    ]);

    return {
      ...this.toLabourerRecord(item),
      summary: {
        totalPaid: overallAgg._sum.amount ?? 0,
        paymentsCount: overallAgg._count._all,
        firstPaidAt: overallAgg._min.date,
        lastPaidAt: overallAgg._max.date,
        largestPayment: overallAgg._max.amount ?? 0,
        avgPayment: overallAgg._avg.amount ?? 0,
        paidThisMonth: monthAgg._sum.amount ?? 0,
        monthPaymentsCount: monthAgg._count._all,
      },
    };
  }

  async updateLabourer(user: AuthUser, id: string, dto: UpdateExtraLabourDto) {
    const existing = await this.prisma.extraLabour.findFirst({
      where: { id, vendorId: user.vendorId },
    });

    if (!existing) {
      throw new NotFoundException('Extra labourer not found');
    }

    if (dto.labourTypeId) {
      const type = await this.prisma.extraLabourType.findFirst({
        where: { id: dto.labourTypeId, vendorId: user.vendorId },
      });
      if (!type) {
        throw new NotFoundException('Extra labour type not found');
      }
    }

    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    const rawPhone = dto.phone !== undefined ? dto.phone : dto.phoneNumber;
    let hasDuplicatePhone = false;
    if (rawPhone !== undefined) {
      const formattedPhone = rawPhone ? normalizePhone(rawPhone) : null;
      data.phoneNumber = formattedPhone;
      if (formattedPhone && formattedPhone !== existing.phoneNumber) {
        const dup = await this.prisma.extraLabour.findFirst({
          where: { vendorId: user.vendorId, phoneNumber: formattedPhone, isActive: true, id: { not: id } },
        });
        if (dup) hasDuplicatePhone = true;
      }
    }
    if (dto.cnic !== undefined) data.cnic = dto.cnic ? dto.cnic.trim() : null;
    if (dto.labourTypeId !== undefined) data.labourTypeId = dto.labourTypeId;
    if (dto.notes !== undefined) data.notes = dto.notes ? dto.notes.trim() : null;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    const updated = await this.prisma.extraLabour.update({
      where: { id },
      data,
      include: {
        labourType: { select: { id: true, name: true } },
      },
    });

    let action = 'UPDATED';
    if (dto.isActive !== undefined && dto.isActive !== existing.isActive) {
      action = dto.isActive ? 'REACTIVATED' : 'DEACTIVATED';
    }

    await this.audit.log({
      vendorId: user.vendorId,
      userId: user.userId,
      userName: user.name,
      action,
      entity: 'ExtraLabour',
      entityId: id,
      changes: { before: existing, after: updated },
    });

    return {
      data: this.toLabourerRecord(updated),
      warnings: hasDuplicatePhone ? ['A labourer with this phone number already exists.'] : [],
    };
  }

  async getLabourerPayments(vendorId: string, id: string, query: ExtraLabourPaymentsQueryDto) {
    const existing = await this.prisma.extraLabour.findFirst({
      where: { id, vendorId },
    });

    if (!existing) {
      throw new NotFoundException('Extra labourer not found');
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: any = {
      vendorId,
      extraLabourId: id,
    };

    if (query.from || query.to) {
      where.date = {};
      if (query.from) where.date.gte = new Date(query.from);
      if (query.to) where.date.lte = new Date(query.to);
    }

    const [total, aggregate, items] = await Promise.all([
      this.prisma.expense.count({ where }),
      this.prisma.expense.aggregate({
        where,
        _sum: { amount: true },
      }),
      this.prisma.expense.findMany({
        where,
        include: {
          createdBy: { select: { id: true, name: true } },
          dailySheet: { select: { id: true, date: true } },
          van: { select: { id: true, plateNumber: true } },
        },
        orderBy: { date: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    const data = items.map((exp) => ({
      id: exp.id,
      expenseId: exp.id,
      amount: exp.amount,
      date: exp.date,
      description: exp.description,
      paidFromCash: exp.paidFromCash,
      vanPlateNumber: exp.van?.plateNumber ?? null,
      recordedByName: exp.createdBy?.name ?? null,
      dailySheetId: exp.dailySheetId,
    }));

    return {
      data,
      rangeSubtotal: aggregate._sum.amount ?? 0,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}
