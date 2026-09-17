import {
  BadRequestException,
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

// SALESMAN is treated as an interchangeable field-driver role (see
// daily-sheet.controller.ts's identical rule, S43 2026-09-15 parity): a
// salesman driving their own route needs the exact same conversation
// scoping, "waiting on" side, and notification routing a DRIVER gets.
// Every place this module used to key off `UserRole.DRIVER` alone now keys
// off this pair instead.
const FIELD_DRIVER_ROLES: UserRole[] = [UserRole.DRIVER, UserRole.SALESMAN];
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
   * Loads a sheet item and verifies tenancy (+ current-driver-or-crew scope
   * for DRIVER/SALESMAN callers). Authorization always resolves the sheet's
   * CURRENT driver and crew — never the denormalized Conversation.driverId.
   * Not private: MessageService reuses this as the single source of truth
   * for item-scoped authorization (get-or-create, send) — see
   * resolveConversationForUser for why sending can't reuse *that* method's
   * history-based check instead.
   *
   * Crew, not just driverId: a SALESMAN (or DRIVER) can ride as supporting
   * crew (DailySheetCrew) on a sheet someone else drives — the exact same
   * driver-or-crew gap this module's daily-sheet counterparts already close
   * (e.g. the own-sheets list filter's `OR: [{driverId}, {crew:{some:...}}]`
   * ). A crew-only member must get the same conversation access as the
   * driver, not a 404.
   */
  async resolveItemForUser(user: AuthUser, itemId: string) {
    const item = await this.prisma.dailySheetItem.findUnique({
      where: { id: itemId },
      include: {
        dailySheet: {
          select: {
            id: true,
            vendorId: true,
            vanId: true,
            driverId: true,
            date: true,
            crew: { select: { userId: true } },
          },
        },
      },
    });
    if (!item || item.dailySheet.vendorId !== user.vendorId) {
      throw new NotFoundException('Sheet item not found');
    }
    if (FIELD_DRIVER_ROLES.includes(user.role)) {
      const isOnSheet =
        item.dailySheet.driverId === user.userId ||
        item.dailySheet.crew.some((c) => c.userId === user.userId);
      if (!isOnSheet) throw new NotFoundException('Sheet item not found');
    }
    return item;
  }

  /**
   * Tenancy + driver-scope check for an existing conversation. 404 on
   * mismatch. Conversation is per-customer now, so DRIVER scope can't resolve
   * a single "current driver" the way item-scoped checks do — it uses
   * history instead: has this driver ever sent/received a message in this
   * thread (via one of their own sheets)? Used by read/manage operations
   * (getMessages, markRead, findOne, updateStatus). Sending uses a different,
   * item-scoped check (message.service.ts's resolveOpenForSending) because a
   * driver's very first message in a brand-new thread has no history yet.
   */
  async resolveConversationForUser(user: AuthUser, conversationId: string) {
    const conversation = await this.prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!conversation || conversation.vendorId !== user.vendorId) {
      throw new NotFoundException('Conversation not found');
    }
    if (FIELD_DRIVER_ROLES.includes(user.role)) {
      // Driver OR crew (same gap as resolveItemForUser above) — a message
      // whose item was on a sheet this user rode as supporting crew counts
      // as history too, not just sheets they personally drove.
      const hasAccess = await this.prisma.conversationMessage.findFirst({
        where: {
          conversationId,
          item: {
            dailySheet: {
              OR: [{ driverId: user.userId }, { crew: { some: { userId: user.userId } } }],
            },
          },
        },
        select: { id: true },
      });
      if (!hasAccess) throw new NotFoundException('Conversation not found');
    }
    return conversation;
  }

  /**
   * Read-path access check used by getMessages/markRead. When the caller
   * knows which delivery item it's currently viewing (always true from
   * `ConversationThread`, which never renders without an itemId), prefer the
   * item-scoped check — immediate and correct even with zero message
   * history. Falls back to the history-based check only when no itemId is
   * given (defensive; shouldn't happen from the frontend in practice).
   */
  async resolveConversationForRead(user: AuthUser, conversationId: string, itemId?: string) {
    if (!itemId) return this.resolveConversationForUser(user, conversationId);
    const item = await this.resolveItemForUser(user, itemId);
    const conversation = await this.prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!conversation || conversation.vendorId !== user.vendorId) {
      throw new NotFoundException('Conversation not found');
    }
    if (item.customerId !== conversation.customerId) {
      throw new NotFoundException('Conversation not found');
    }
    return conversation;
  }

  private waitingOn(lastMessageSenderRole: string | null): WaitingOn {
    if (!lastMessageSenderRole) return null;
    return FIELD_DRIVER_ROLES.includes(lastMessageSenderRole as UserRole) ? 'OFFICE' : 'DRIVER';
  }

  // ── get-or-create (THE entry seam, incl. future Collection Policy) ─────────

  async getOrCreateForItem(user: AuthUser, itemId: string) {
    const item = await this.resolveItemForUser(user, itemId);
    // Bare shell only — no delivery-context rollup fields on create. Those
    // are written exclusively inside message.service.ts's createMessage
    // transaction, never on mere open, so expanding a delivery card can
    // never leave a trace beyond "this customer has a conversation row"
    // (and even that stays hidden from the inbox until messageCount > 0).
    const conversation = await this.prisma.conversation.upsert({
      where: { vendorId_customerId: { vendorId: user.vendorId, customerId: item.customerId } },
      update: {},
      create: {
        vendorId: user.vendorId,
        customerId: item.customerId,
      },
      include: CONVERSATION_INCLUDE,
    });
    return { ...conversation, waitingOn: this.waitingOn(conversation.lastMessageSenderRole) };
  }

  /**
   * Customer-list entry point (no delivery/item context available on that
   * page). ConversationMessage.dailySheetItemId is a hard, non-nullable FK,
   * so the composer still needs a real item to tag messages with — this
   * resolves it server-side to the customer's most recent DailySheetItem
   * (any status; ordered by the sheet's own date, not createdAt, so a
   * backfilled/corrected item from an older date never wins over today's)
   * instead of requiring the caller to already know one, the way
   * getOrCreateForItem does. Same bare-shell upsert as getOrCreateForItem
   * otherwise.
   */
  async getOrCreateForCustomer(user: AuthUser, customerId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, vendorId: user.vendorId },
      select: { id: true },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    const item = await this.prisma.dailySheetItem.findFirst({
      where: { customerId, dailySheet: { vendorId: user.vendorId } },
      orderBy: [{ dailySheet: { date: 'desc' } }, { createdAt: 'desc' }],
      select: { id: true, dailySheetId: true, status: true },
    });
    if (!item) {
      throw new BadRequestException(
        'This customer has no deliveries on record yet — a conversation can only be started once a delivery has been scheduled.',
      );
    }

    const conversation = await this.prisma.conversation.upsert({
      where: { vendorId_customerId: { vendorId: user.vendorId, customerId } },
      update: {},
      create: {
        vendorId: user.vendorId,
        customerId,
      },
      include: CONVERSATION_INCLUDE,
    });

    return {
      ...conversation,
      waitingOn: this.waitingOn(conversation.lastMessageSenderRole),
      itemId: item.id,
      sheetId: item.dailySheetId,
      isItemPending: item.status === 'PENDING',
    };
  }

  // ── inbox list ──────────────────────────────────────────────────────────────

  async findMany(user: AuthUser, query: ConversationQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    // Hide empty shells: a Conversation row can exist (get-or-create fires on
    // every delivery-card open) with zero messages ever sent. Those aren't
    // real conversations and shouldn't clutter the inbox.
    const where: Prisma.ConversationWhereInput = { vendorId: user.vendorId, messageCount: { gt: 0 } };
    if (FIELD_DRIVER_ROLES.includes(user.role)) {
      // History-based scope (per owner decision): a driver's inbox shows
      // every customer thread they've personally sent/received a message in,
      // even after a later route reassignment. The embedded thread on their
      // own current delivery card works regardless (item-scoped auth), so
      // this is purely a convenience aggregator, not the only access path.
      // Driver OR crew — see resolveItemForUser for why.
      where.messages = {
        some: {
          item: { dailySheet: { OR: [{ driverId: user.userId }, { crew: { some: { userId: user.userId } } }] } },
        },
      };
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
      where.lastMessageSenderRole = { in: FIELD_DRIVER_ROLES };
    } else if (query.waitingOn === 'DRIVER') {
      where.lastMessageAt = { not: null };
      where.lastMessageSenderRole = { notIn: FIELD_DRIVER_ROLES };
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
    // History-based (same rule as findMany's driver scope): a driver's
    // unread badge only counts threads they've personally been part of.
    // Driver OR crew (LEFT JOIN "DailySheetCrew" — same gap as
    // resolveItemForUser above) — a sheet this user rode as supporting crew
    // counts as "been part of" too, not just sheets they personally drove.
    const driverScope =
      FIELD_DRIVER_ROLES.includes(user.role)
        ? Prisma.sql`AND EXISTS (
            SELECT 1 FROM "ConversationMessage" m
            JOIN "DailySheetItem" i ON i."id" = m."dailySheetItemId"
            JOIN "DailySheet" s ON s."id" = i."dailySheetId"
            LEFT JOIN "DailySheetCrew" dsc ON dsc."dailySheetId" = s."id" AND dsc."userId" = ${user.userId}
            WHERE m."conversationId" = c."id" AND (s."driverId" = ${user.userId} OR dsc."userId" IS NOT NULL)
          )`
        : Prisma.empty;
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT c."id"
      FROM "Conversation" c
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

  async markRead(user: AuthUser, id: string, itemId?: string) {
    await this.resolveConversationForRead(user, id, itemId);
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
