import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { ConversationStatus, Prisma, UserRole } from '@prisma/client';
import { paginate } from '../../common/helpers/paginate';
import { AuditService } from '../audit/audit.service';
import { ConversationQueryDto } from './dto/conversation-query.dto';
import type { AuthUser } from '@water-supply-crm/types';

// Context block returned with every conversation (inbox rows + detail).
const CONVERSATION_INCLUDE = {
  customer: { select: { id: true, name: true, customerCode: true, phoneNumber: true } },
  dailySheet: { select: { id: true, date: true, isClosed: true } },
  van: { select: { id: true, plateNumber: true } },
  driver: { select: { id: true, name: true } },
  item: {
    select: {
      id: true,
      sequence: true,
      status: true,
      product: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.ConversationInclude;

type WaitingOn = 'DRIVER' | 'OFFICE' | null;

@Injectable()
export class ConversationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── access helpers ──────────────────────────────────────────────────────────

  /**
   * Loads a sheet item and verifies tenancy (+ current-driver scope for DRIVER
   * callers). Authorization always resolves the sheet's CURRENT driver — never
   * the denormalized Conversation.driverId.
   */
  private async resolveItemForUser(user: AuthUser, itemId: string) {
    const item = await this.prisma.dailySheetItem.findUnique({
      where: { id: itemId },
      include: { dailySheet: { select: { id: true, vendorId: true, vanId: true, driverId: true, date: true } } },
    });
    if (!item || item.dailySheet.vendorId !== user.vendorId) {
      throw new NotFoundException('Sheet item not found');
    }
    if (user.role === UserRole.DRIVER && item.dailySheet.driverId !== user.userId) {
      throw new NotFoundException('Sheet item not found');
    }
    return item;
  }

  /** Tenancy + driver-scope check for an existing conversation. 404 on mismatch. */
  async resolveConversationForUser(user: AuthUser, conversationId: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { item: { select: { dailySheet: { select: { driverId: true } } } } },
    });
    if (!conversation || conversation.vendorId !== user.vendorId) {
      throw new NotFoundException('Conversation not found');
    }
    if (user.role === UserRole.DRIVER && conversation.item.dailySheet.driverId !== user.userId) {
      throw new NotFoundException('Conversation not found');
    }
    return conversation;
  }

  private waitingOn(lastMessageSenderRole: string | null): WaitingOn {
    if (!lastMessageSenderRole) return null;
    return lastMessageSenderRole === UserRole.DRIVER ? 'OFFICE' : 'DRIVER';
  }

  // ── get-or-create (THE entry seam, incl. future Collection Policy) ─────────

  async getOrCreateForItem(user: AuthUser, itemId: string) {
    const item = await this.resolveItemForUser(user, itemId);
    const conversation = await this.prisma.conversation.upsert({
      where: { dailySheetItemId: itemId },
      update: {},
      create: {
        vendorId: user.vendorId,
        dailySheetItemId: itemId,
        dailySheetId: item.dailySheet.id,
        customerId: item.customerId,
        vanId: item.dailySheet.vanId,
        driverId: item.dailySheet.driverId,
        deliveryDate: item.dailySheet.date,
      },
      include: CONVERSATION_INCLUDE,
    });
    return { ...conversation, waitingOn: this.waitingOn(conversation.lastMessageSenderRole) };
  }

  // ── inbox list ──────────────────────────────────────────────────────────────

  async findMany(user: AuthUser, query: ConversationQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.ConversationWhereInput = { vendorId: user.vendorId };
    if (user.role === UserRole.DRIVER) {
      // Scope to the sheet's CURRENT driver (survives swap-assignment).
      where.item = { dailySheet: { driverId: user.userId } };
    }
    if (query.status) where.status = query.status;
    if (query.vanId) where.vanId = query.vanId;
    if (query.driverId) where.driverId = query.driverId;
    if (query.customerId) where.customerId = query.customerId;
    if (query.dateFrom || query.dateTo) {
      where.deliveryDate = {
        ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
        ...(query.dateTo ? { lte: new Date(`${query.dateTo}T23:59:59.999Z`) } : {}),
      };
    }
    if (query.waitingOn === 'OFFICE') {
      where.lastMessageSenderRole = UserRole.DRIVER;
    } else if (query.waitingOn === 'DRIVER') {
      where.lastMessageAt = { not: null };
      where.lastMessageSenderRole = { not: UserRole.DRIVER };
    }
    if (query.search) {
      where.OR = [
        { customer: { name: { contains: query.search, mode: 'insensitive' } } },
        { customer: { customerCode: { contains: query.search, mode: 'insensitive' } } },
        { lastMessagePreview: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.unreadOnly) {
      const unreadIds = await this.getUnreadConversationIds(user);
      where.id = { in: unreadIds };
    }

    const [total, conversations] = await Promise.all([
      this.prisma.conversation.count({ where }),
      this.prisma.conversation.findMany({
        where,
        include: CONVERSATION_INCLUDE,
        orderBy: { lastMessageAt: { sort: 'desc', nulls: 'last' } },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    // Per-row unread counts: bounded by page size, each an indexed count.
    const reads = await this.prisma.conversationRead.findMany({
      where: { userId: user.userId, conversationId: { in: conversations.map((c) => c.id) } },
    });
    const readMap = new Map(reads.map((r) => [r.conversationId, r.lastReadAt]));

    const rows = await Promise.all(
      conversations.map(async (c) => {
        const watermark = readMap.get(c.id);
        const unreadCount = await this.prisma.conversationMessage.count({
          where: {
            conversationId: c.id,
            deletedAt: null,
            createdById: { not: user.userId },
            ...(watermark ? { createdAt: { gt: watermark } } : {}),
          },
        });
        return { ...c, unreadCount, waitingOn: this.waitingOn(c.lastMessageSenderRole) };
      }),
    );

    return paginate(rows, total, page, limit);
  }

  /**
   * Conversations with activity newer than the caller's watermark, from a
   * counterpart sender. Raw SQL because Prisma cannot compare two columns
   * (lastMessageAt vs the joined watermark).
   */
  private async getUnreadConversationIds(user: AuthUser): Promise<string[]> {
    const driverScope =
      user.role === UserRole.DRIVER
        ? Prisma.sql`AND s."driverId" = ${user.userId}`
        : Prisma.empty;
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT c."id"
      FROM "Conversation" c
      JOIN "DailySheetItem" i ON i."id" = c."dailySheetItemId"
      JOIN "DailySheet" s ON s."id" = i."dailySheetId"
      LEFT JOIN "ConversationRead" r
        ON r."conversationId" = c."id" AND r."userId" = ${user.userId}
      WHERE c."vendorId" = ${user.vendorId}
        AND c."lastMessageAt" IS NOT NULL
        AND c."lastMessageSenderId" IS DISTINCT FROM ${user.userId}
        AND c."lastMessageAt" > COALESCE(r."lastReadAt", to_timestamp(0))
        ${driverScope}
    `;
    return rows.map((r) => r.id);
  }

  async getUnreadCount(user: AuthUser) {
    const ids = await this.getUnreadConversationIds(user);
    return { count: ids.length };
  }

  // ── detail ──────────────────────────────────────────────────────────────────

  async findOne(user: AuthUser, id: string) {
    await this.resolveConversationForUser(user, id);
    const conversation = await this.prisma.conversation.findUnique({
      where: { id },
      include: CONVERSATION_INCLUDE,
    });
    if (!conversation) throw new NotFoundException('Conversation not found');
    return { ...conversation, waitingOn: this.waitingOn(conversation.lastMessageSenderRole) };
  }

  // ── read watermark ──────────────────────────────────────────────────────────

  async markRead(user: AuthUser, id: string) {
    await this.resolveConversationForUser(user, id);
    const lastReadAt = new Date();
    await this.prisma.conversationRead.upsert({
      where: { conversationId_userId: { conversationId: id, userId: user.userId } },
      update: { lastReadAt },
      create: { conversationId: id, userId: user.userId, lastReadAt },
    });
    return { success: true, lastReadAt };
  }

  // ── status workflow (office only — enforced at controller) ─────────────────

  async updateStatus(user: AuthUser, id: string, status: ConversationStatus) {
    const conversation = await this.resolveConversationForUser(user, id);
    if (conversation.status === status) return this.findOne(user, id); // idempotent

    // CLOSED is the archive state: only reopening (→ OPEN) is allowed from it.
    if (conversation.status === ConversationStatus.CLOSED && status !== ConversationStatus.OPEN) {
      throw new UnprocessableEntityException('A closed conversation can only be reopened');
    }

    await this.prisma.conversation.update({ where: { id }, data: { status } });
    await this.audit.log({
      vendorId: user.vendorId,
      userId: user.userId,
      userName: user.name,
      action: 'CONVERSATION_STATUS_CHANGE',
      entity: 'Conversation',
      entityId: id,
      changes: { before: { status: conversation.status }, after: { status } },
    });
    return this.findOne(user, id);
  }
}
