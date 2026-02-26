import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { DeliveryIssueStatus } from '@prisma/client';
import { paginate } from '../../common/helpers/paginate';
import { DeliveryIssueQueryDto } from './dto/delivery-issue-query.dto';
import { PlanIssueDto } from './dto/plan-issue.dto';
import { ResolveIssueDto } from './dto/resolve-issue.dto';

const ISSUE_INCLUDE = {
  dailySheetItem: {
    select: {
      id: true,
      sequence: true,
      status: true,
      failureCategory: true,
      reason: true,
      customer: { select: { id: true, name: true, customerCode: true, address: true } },
      product: { select: { id: true, name: true } },
      dailySheet: {
        select: {
          id: true,
          date: true,
          route: { select: { id: true, name: true } },
          van: { select: { id: true, plateNumber: true } },
          driver: { select: { id: true, name: true } },
        },
      },
    },
  },
} as const;

@Injectable()
export class DeliveryIssueService {
  constructor(private prisma: PrismaService) {}

  async findAll(vendorId: string, query: DeliveryIssueQueryDto) {
    const { page = 1, limit = 20, status, sheetId, dateFrom, dateTo } = query;

    const where: any = { vendorId };
    if (status) where.status = status;
    if (sheetId) {
      where.dailySheetItem = { dailySheetId: sheetId };
    }
    if (dateFrom || dateTo) {
      const dateFilter: any = {};
      if (dateFrom) dateFilter.gte = new Date(dateFrom);
      if (dateTo) dateFilter.lte = new Date(dateTo);
      if (!where.dailySheetItem) where.dailySheetItem = {};
      where.dailySheetItem.dailySheet = { date: dateFilter };
    }

    const [data, total] = await Promise.all([
      this.prisma.deliveryIssue.findMany({
        where,
        include: ISSUE_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.deliveryIssue.count({ where }),
    ]);

    return paginate(data, total, page, limit);
  }

  async findOne(vendorId: string, id: string) {
    const issue = await this.prisma.deliveryIssue.findFirst({
      where: { id, vendorId },
      include: ISSUE_INCLUDE,
    });
    if (!issue) throw new NotFoundException('Delivery issue not found');
    return issue;
  }

  async plan(vendorId: string, id: string, dto: PlanIssueDto, plannedById: string) {
    const issue = await this.prisma.deliveryIssue.findFirst({
      where: { id, vendorId },
    });
    if (!issue) throw new NotFoundException('Delivery issue not found');
    if (issue.status === DeliveryIssueStatus.RESOLVED || issue.status === DeliveryIssueStatus.DROPPED) {
      throw new BadRequestException(`Cannot plan an issue with status ${issue.status}`);
    }

    const nextStatus =
      issue.status === DeliveryIssueStatus.OPEN
        ? DeliveryIssueStatus.PLANNED
        : issue.status;

    return this.prisma.deliveryIssue.update({
      where: { id },
      data: {
        status: nextStatus,
        nextAction: dto.nextAction,
        retryAt: dto.retryAt ? new Date(dto.retryAt) : undefined,
        assignedToUserId: dto.assignedToUserId ?? null,
        assignedVanId: dto.assignedVanId ?? null,
        assignedDriverId: dto.assignedDriverId ?? null,
        planNotes: dto.notes ?? null,
        plannedAt: new Date(),
        plannedById,
      },
      include: ISSUE_INCLUDE,
    });
  }

  async resolve(vendorId: string, id: string, dto: ResolveIssueDto, resolvedById: string) {
    const issue = await this.prisma.deliveryIssue.findFirst({
      where: { id, vendorId },
    });
    if (!issue) throw new NotFoundException('Delivery issue not found');
    if (issue.status === DeliveryIssueStatus.RESOLVED || issue.status === DeliveryIssueStatus.DROPPED) {
      throw new BadRequestException(`Issue is already ${issue.status}`);
    }

    return this.prisma.deliveryIssue.update({
      where: { id },
      data: {
        status: DeliveryIssueStatus.RESOLVED,
        resolution: dto.resolution,
        resolvedNotes: dto.notes ?? null,
        resolvedAt: new Date(),
        resolvedById,
      },
      include: ISSUE_INCLUDE,
    });
  }

  async createForItem(vendorId: string, dailySheetItemId: string) {
    const existing = await this.prisma.deliveryIssue.findUnique({
      where: { dailySheetItemId },
    });
    if (existing) return existing;

    return this.prisma.deliveryIssue.create({
      data: {
        vendorId,
        dailySheetItemId,
        status: DeliveryIssueStatus.OPEN,
      },
    });
  }
}
