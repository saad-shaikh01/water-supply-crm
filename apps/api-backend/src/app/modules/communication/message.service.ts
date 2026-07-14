import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { ConversationStatus, MessageType, UserRole } from '@prisma/client';
import { StorageService } from '../../common/storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { ConversationService } from './conversation.service';
import { InAppNotificationService } from '../notifications/in-app-notification.service';
import { NotificationService } from '../notifications/notification.service';
import type { AuthUser } from '@water-supply-crm/types';

// Same Wasabi prefix as the legacy note system — existing audio keys and new
// uploads live side by side; no storage migration.
const VOICE_PREFIX = 'delivery-voice-notes';
const PREVIEW_LENGTH = 120;
const VOICE_PREVIEW = '🎤 Voice message';

// NotificationPreference.eventType key for this feature (Phase 4).
const NOTIFICATION_EVENT_TYPE = 'conversation.message';
const IN_APP_NOTIFICATION_TYPE = 'CONVERSATION_MESSAGE';

const CREATED_BY_INCLUDE = { createdBy: { select: { id: true, name: true } } };

@Injectable()
export class MessageService {
  private readonly logger = new Logger(MessageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly conversations: ConversationService,
    private readonly inAppNotifications: InAppNotificationService,
    private readonly notifications: NotificationService,
  ) {}

  // ── read ────────────────────────────────────────────────────────────────────

  async getMessages(
    user: AuthUser,
    conversationId: string,
    query: { before?: string; limit?: number },
  ) {
    await this.conversations.resolveConversationForUser(user, conversationId);
    const limit = query.limit ?? 30;
    const chunk = await this.prisma.conversationMessage.findMany({
      where: {
        conversationId,
        deletedAt: null,
        ...(query.before ? { createdAt: { lt: new Date(query.before) } } : {}),
      },
      include: CREATED_BY_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
    });
    const hasMore = chunk.length > limit;
    const pageDesc = hasMore ? chunk.slice(0, limit) : chunk;
    return {
      // Ascending within the page (oldest first) — natural chat render order.
      messages: [...pageDesc].reverse(),
      nextCursor: hasMore ? pageDesc[pageDesc.length - 1].createdAt.toISOString() : null,
    };
  }

  // ── send ────────────────────────────────────────────────────────────────────

  async sendText(
    user: AuthUser,
    conversationId: string,
    dto: { text: string; requiresAck?: boolean },
  ) {
    const conversation = await this.resolveOpenForSending(user, conversationId);
    if (!dto.text?.trim()) {
      throw new BadRequestException('Message text is required');
    }
    return this.createMessage(user, conversation, {
      type: MessageType.TEXT,
      text: dto.text.trim(),
      requiresAck: this.resolveRequiresAck(user, dto.requiresAck),
    });
  }

  async sendVoice(
    user: AuthUser,
    conversationId: string,
    file: Express.Multer.File,
    audioDuration?: number,
    requiresAck?: boolean,
  ) {
    const conversation = await this.resolveOpenForSending(user, conversationId);
    const audioKey = await this.uploadVoice(file);
    return this.createMessage(user, conversation, {
      type: MessageType.VOICE,
      audioKey,
      audioDuration: audioDuration ?? null,
      requiresAck: this.resolveRequiresAck(user, requiresAck),
    });
  }

  private resolveRequiresAck(user: AuthUser, requested?: boolean): boolean {
    // Driver messages never block a delivery.
    if (user.role === UserRole.DRIVER) return false;
    return !!requested;
  }

  private async resolveOpenForSending(user: AuthUser, conversationId: string) {
    const conversation = await this.conversations.resolveConversationForUser(user, conversationId);
    if (conversation.status === ConversationStatus.CLOSED) {
      throw new ConflictException('This conversation is closed. Reopen it before sending messages.');
    }
    return conversation;
  }

  private async uploadVoice(file: Express.Multer.File): Promise<string> {
    try {
      const { key } = await this.storage.upload(
        VOICE_PREFIX,
        file.buffer,
        file.originalname,
        file.mimetype,
      );
      return key;
    } catch (err) {
      this.logger.error(
        `Voice message upload failed: ${(err as Error)?.message ?? String(err)}`,
        (err as Error)?.stack,
      );
      throw new InternalServerErrorException('Failed to upload voice message');
    }
  }

  /**
   * Message insert + conversation rollups in one transaction; auto-reopens a
   * RESOLVED conversation (a reply must never stay buried under Resolved).
   */
  private async createMessage(
    user: AuthUser,
    conversation: { id: string; dailySheetItemId: string; status: ConversationStatus },
    data: {
      type: MessageType;
      text?: string;
      audioKey?: string;
      audioDuration?: number | null;
      requiresAck: boolean;
    },
  ) {
    const preview =
      data.type === MessageType.VOICE
        ? VOICE_PREVIEW
        : (data.text ?? '').slice(0, PREVIEW_LENGTH);

    const message = await this.prisma.$transaction(async (tx) => {
      const created = await tx.conversationMessage.create({
        data: {
          vendorId: user.vendorId,
          conversationId: conversation.id,
          dailySheetItemId: conversation.dailySheetItemId,
          createdById: user.userId,
          type: data.type,
          text: data.text ?? null,
          audioKey: data.audioKey ?? null,
          audioDuration: data.audioDuration ?? null,
          requiresAck: data.requiresAck,
        },
        include: CREATED_BY_INCLUDE,
      });
      await tx.conversation.update({
        where: { id: conversation.id },
        data: {
          lastMessageAt: created.createdAt,
          lastMessagePreview: preview,
          lastMessageSenderId: user.userId,
          lastMessageSenderRole: user.role,
          messageCount: { increment: 1 },
          ...(conversation.status === ConversationStatus.RESOLVED
            ? { status: ConversationStatus.OPEN }
            : {}),
        },
      });
      return created;
    });

    this.onMessageCreated(message, user, conversation);
    return message;
  }

  /**
   * Post-create hook seam (LOCKED architecture §5.7). Phase 4 attaches
   * FCM/in-app notifications here; future AI phases attach transcription and
   * summary queue jobs.
   *
   * Fire-and-forget (not awaited by the caller): the notification fan-out
   * can reach every office user, and the message-send response must not
   * wait on that round trip. Failures are logged, never surfaced to the
   * sender — a notification failure must not look like a failed send.
   */
  private onMessageCreated(
    message: { id: string; type: MessageType; text: string | null },
    user: AuthUser,
    conversation: { id: string },
  ): void {
    this.notifyRecipients(message, user, conversation).catch((err) => {
      this.logger.warn(
        `Conversation message notification failed: ${(err as Error)?.message ?? String(err)}`,
      );
    });
  }

  /**
   * Notifies the "counterpart side" (LOCKED §5.4): a driver's message
   * notifies every ADMIN/STAFF of the vendor (shared office inbox, no
   * Participant table — same derivation rule as conversation access); an
   * office message notifies the sheet's CURRENT driver, resolved fresh here
   * rather than trusting the denormalized Conversation.driverId.
   */
  private async notifyRecipients(
    message: { id: string; type: MessageType; text: string | null },
    user: AuthUser,
    conversation: { id: string },
  ) {
    const context = await this.prisma.conversation.findUnique({
      where: { id: conversation.id },
      select: {
        customer: { select: { name: true } },
        item: { select: { sequence: true, dailySheet: { select: { driverId: true } } } },
      },
    });
    if (!context) return;

    const preview =
      message.type === MessageType.VOICE ? VOICE_PREVIEW : (message.text ?? '').slice(0, PREVIEW_LENGTH);
    const title = user.name;
    const body = `${context.customer.name} · Stop #${context.item.sequence}: ${preview}`;

    const recipientIds =
      user.role === UserRole.DRIVER
        ? (
            await this.prisma.user.findMany({
              where: {
                vendorId: user.vendorId,
                role: { in: [UserRole.VENDOR_ADMIN, UserRole.STAFF] },
                isActive: true,
              },
              select: { id: true },
            })
          ).map((u) => u.id)
        : [context.item.dailySheet.driverId];

    await Promise.all(
      recipientIds.map((userId) =>
        this.notifyUser(userId, user.vendorId, conversation.id, message.id, title, body),
      ),
    );
  }

  private async notifyUser(
    userId: string,
    vendorId: string,
    conversationId: string,
    messageId: string,
    title: string,
    body: string,
  ) {
    const [inAppEnabled, pushEnabled] = await Promise.all([
      this.isPreferenceEnabled(userId, 'IN_APP'),
      this.isPreferenceEnabled(userId, 'FCM'),
    ]);

    if (inAppEnabled) {
      await this.inAppNotifications.create({
        userId,
        vendorId,
        type: IN_APP_NOTIFICATION_TYPE,
        title,
        message: body,
        entityId: conversationId,
      });
    }
    if (pushEnabled) {
      await this.notifications.queueFcm(
        userId,
        title,
        body,
        { type: IN_APP_NOTIFICATION_TYPE, conversationId },
        `conversation-message-${messageId}-${userId}`,
      );
    }
  }

  /**
   * Per-user opt-out (NotificationPreference — distinct from the vendor-level
   * NotificationType/NotificationChannel master gate used by customer-facing
   * WhatsApp flows, which does not apply to this internal driver/office
   * feature). Absent row = not yet customized = enabled, matching the
   * model's own `enabled Boolean @default(true)`.
   */
  private async isPreferenceEnabled(userId: string, channel: 'IN_APP' | 'FCM'): Promise<boolean> {
    const pref = await this.prisma.notificationPreference.findUnique({
      where: { userId_eventType_channel: { userId, eventType: NOTIFICATION_EVENT_TYPE, channel } },
    });
    return pref?.enabled ?? true;
  }

  // ── acknowledge / audio (unchanged semantics from the note system) ─────────

  async acknowledge(user: AuthUser, messageId: string) {
    const message = await this.prisma.conversationMessage.findUnique({
      where: { id: messageId },
      include: { item: { include: { dailySheet: { select: { vendorId: true } } } } },
    });
    if (!message || message.item.dailySheet.vendorId !== user.vendorId) {
      throw new NotFoundException('Message not found');
    }
    if (message.acknowledgedAt) {
      // already acknowledged — idempotent
      return this.prisma.conversationMessage.findUnique({
        where: { id: messageId },
        include: CREATED_BY_INCLUDE,
      });
    }
    const updated = await this.prisma.conversationMessage.update({
      where: { id: messageId },
      data: { acknowledgedAt: new Date(), acknowledgedById: user.userId },
      include: CREATED_BY_INCLUDE,
    });
    await this.audit.log({
      vendorId: user.vendorId,
      userId: user.userId,
      userName: user.name,
      action: 'ACKNOWLEDGE_MESSAGE',
      entity: 'ConversationMessage',
      entityId: messageId,
      changes: { after: { acknowledgedAt: updated.acknowledgedAt, acknowledgedById: user.userId } },
    });
    return updated;
  }

  async getAudioUrl(vendorId: string, messageId: string) {
    const message = await this.prisma.conversationMessage.findUnique({
      where: { id: messageId },
      include: { item: { include: { dailySheet: { select: { vendorId: true } } } } },
    });
    if (!message || message.item.dailySheet.vendorId !== vendorId) {
      throw new NotFoundException('Message not found');
    }
    if (message.type !== MessageType.VOICE || !message.audioKey) {
      throw new BadRequestException('This message does not have a voice recording');
    }
    const signedUrl = await this.storage.getSignedUrl(message.audioKey, 900);
    return { signedUrl };
  }

  // ── legacy note-endpoint adapters (removed in Phase 7) ─────────────────────

  /** Legacy GET items/:id/notes — same shape/order as the old getNotes. */
  async getMessagesForItem(vendorId: string, itemId: string) {
    const item = await this.prisma.dailySheetItem.findUnique({
      where: { id: itemId },
      include: { dailySheet: { select: { vendorId: true } } },
    });
    if (!item || item.dailySheet.vendorId !== vendorId) {
      throw new NotFoundException('Sheet item not found');
    }
    return this.prisma.conversationMessage.findMany({
      where: { dailySheetItemId: itemId, deletedAt: null },
      include: CREATED_BY_INCLUDE,
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Legacy POST items/:id/notes — every legacy note is a blocking instruction. */
  async sendTextForItem(user: AuthUser, itemId: string, text?: string) {
    if (!text?.trim()) {
      throw new BadRequestException('Note text is required for TEXT type notes');
    }
    const conversation = await this.conversations.getOrCreateForItem(user, itemId);
    return this.sendText(user, conversation.id, { text, requiresAck: true });
  }

  /** Legacy POST items/:id/notes/voice — requiresAck true, same as before. */
  async sendVoiceForItem(
    user: AuthUser,
    itemId: string,
    file: Express.Multer.File,
    audioDuration?: number,
  ) {
    const conversation = await this.conversations.getOrCreateForItem(user, itemId);
    return this.sendVoice(user, conversation.id, file, audioDuration, true);
  }
}
