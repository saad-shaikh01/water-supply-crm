import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import type { AuthUser } from '@water-supply-crm/types';
import { AuditService } from '../audit/audit.service';
import { normalizePhone } from '../whatsapp/phone.util';
import { CreateExtraLabourDto } from './dto/create-extra-labour.dto';
import { UpdateExtraLabourDto } from './dto/update-extra-labour.dto';
import { ExtraLabourQueryDto } from './dto/extra-labour-query.dto';
import { ExtraLabourPaymentsQueryDto } from './dto/extra-labour-payments-query.dto';

function getPktMonthRange(): { start: Date; end: Date } {
  const now = new Date();
  // Adjust to PKT (UTC+5)
  const pktMs = now.getTime() + 5 * 3600 * 1000;
  const pktDate = new Date(pktMs);

  const year = pktDate.getUTCFullYear();
  const month = pktDate.getUTCMonth();

  const start = new Date(Date.UTC(year, month, 1, -5, 0, 0, 0));
  const end = new Date(Date.UTC(year, month + 1, 1, -5, 0, 0, -1));

  return { start, end };
}

@Injectable()
export class ExtraLabourService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  async getOptions(vendorId: string, search?: string, includeId?: string) {
    const digitsSearch = search ? search.replace(/\D/g, '') : '';
    const textSearch = search?.trim();

    const where: any = {
      vendorId,
      OR: [
        { isActive: true },
        ...(includeId ? [{ id: includeId }] : []),
      ],
    };

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
        isActive: true,
        labourType: {
          select: { name: true },
        },
      },
      orderBy: { name: 'asc' },
      take: 50,
    });

    return items.map((item) => ({
      id: item.id,
      name: item.name,
      isActive: item.isActive,
      typeName: item.labourType.name,
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
        phoneNumber: item.phoneNumber,
        notes: item.notes,
        isActive: item.isActive,
        type: item.labourType,
        createdBy: item.createdBy,
        totalPaid: itemStats.totalPaid,
        paymentCount: itemStats.paymentCount,
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

    const formattedPhone = dto.phoneNumber ? normalizePhone(dto.phoneNumber) : null;

    let hasDuplicatePhone = false;
    if (formattedPhone) {
      const existing = await this.prisma.extraLabour.findFirst({
        where: {
          vendorId: user.vendorId,
          phoneNumber: formattedPhone,
          isActive: true,
        },
      });
      if (existing) {
        hasDuplicatePhone = true;
      }
    }

    const item = await this.prisma.extraLabour.create({
      data: {
        vendorId: user.vendorId,
        name: dto.name.trim(),
        phoneNumber: formattedPhone,
        labourTypeId: dto.labourTypeId,
        notes: dto.notes?.trim() ?? null,
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

    return {
      ...item,
      duplicatePhoneWarning: hasDuplicatePhone,
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
        _max: { date: true },
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

    const totalPaid = overallAgg._sum.amount ?? 0;
    const paymentCount = overallAgg._count._all;

    return {
      ...item,
      stats: {
        totalPaid,
        paymentCount,
        minDate: overallAgg._min.date,
        maxDate: overallAgg._max.date,
        avgAmount: overallAgg._avg.amount ?? 0,
        paidThisMonth: monthAgg._sum.amount ?? 0,
        monthPaymentCount: monthAgg._count._all,
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
    if (dto.phoneNumber !== undefined) {
      data.phoneNumber = dto.phoneNumber ? normalizePhone(dto.phoneNumber) : null;
    }
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

    return updated;
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

    return {
      data: items,
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
