import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { MessageService } from './message.service';
import { ConversationService } from './conversation.service';
import { StorageService } from '../../common/storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { InAppNotificationService } from '../notifications/in-app-notification.service';
import { NotificationService } from '../notifications/notification.service';
import { ConversationStatus, UserRole } from '@prisma/client';
import type { AuthUser } from '@water-supply-crm/types';

/**
 * Unit tests for MessageService's send path after the per-customer
 * Communication Center redesign (2026-07-17). Sending is item-scoped (via
 * ConversationService.resolveItemForUser), deliberately NOT the
 * history-based check used for reading — a driver's very first message in a
 * brand-new customer thread must work even with zero prior message history.
 */
describe('MessageService.sendText', () => {
  let service: MessageService;
  let mockPrisma: any;
  let mockConversations: any;

  const VENDOR_ID = 'vendor-001';
  const CUSTOMER_ID = 'customer-001';
  const ITEM_ID = 'item-001';
  const CONVERSATION_ID = 'conversation-001';

  const DRIVER_USER: AuthUser = {
    userId: 'driver-1',
    email: 'd@example.com',
    name: 'Driver',
    role: UserRole.DRIVER,
    vendorId: VENDOR_ID,
    customerId: null,
  };

  function buildItem(overrides: Record<string, unknown> = {}) {
    return {
      id: ITEM_ID,
      customerId: CUSTOMER_ID,
      dailySheetId: 'sheet-001',
      dailySheet: {
        id: 'sheet-001',
        vanId: 'van-001',
        driverId: DRIVER_USER.userId,
        date: new Date('2026-07-17T00:00:00.000Z'),
      },
      ...overrides,
    };
  }

  function buildConversation(overrides: Record<string, unknown> = {}) {
    return {
      id: CONVERSATION_ID,
      vendorId: VENDOR_ID,
      customerId: CUSTOMER_ID,
      status: ConversationStatus.OPEN,
      ...overrides,
    };
  }

  beforeEach(async () => {
    mockConversations = {
      resolveItemForUser: jest.fn(),
    };

    mockPrisma = {
      conversation: { findUnique: jest.fn(), update: jest.fn() },
      conversationMessage: { create: jest.fn() },
      $transaction: jest.fn(async (fn: any) => fn(mockPrisma)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MessageService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: StorageService, useValue: {} },
        { provide: AuditService, useValue: { log: jest.fn() } },
        { provide: ConversationService, useValue: mockConversations },
        { provide: InAppNotificationService, useValue: {} },
        { provide: NotificationService, useValue: {} },
      ],
    }).compile();

    service = module.get(MessageService);

    // Silence the fire-and-forget notification path (queries conversation
    // again internally) — irrelevant to these send-path/rollup tests.
    jest.spyOn(service as any, 'notifyRecipients').mockResolvedValue(undefined);
  });

  it('lets a driver send on their own current item with zero prior message history', async () => {
    mockConversations.resolveItemForUser.mockResolvedValue(buildItem());
    mockPrisma.conversation.findUnique.mockResolvedValue(buildConversation());
    mockPrisma.conversationMessage.create.mockResolvedValue({
      id: 'msg-1',
      createdAt: new Date('2026-07-17T10:00:00.000Z'),
    });
    mockPrisma.conversation.update.mockResolvedValue({});

    await expect(
      service.sendText(DRIVER_USER, CONVERSATION_ID, { text: 'on my way', itemId: ITEM_ID }),
    ).resolves.toBeTruthy();

    expect(mockConversations.resolveItemForUser).toHaveBeenCalledWith(DRIVER_USER, ITEM_ID);
  });

  it('rejects when the item does not belong to the conversation customer', async () => {
    mockConversations.resolveItemForUser.mockResolvedValue(buildItem({ customerId: 'someone-else' }));
    mockPrisma.conversation.findUnique.mockResolvedValue(buildConversation());

    await expect(
      service.sendText(DRIVER_USER, CONVERSATION_ID, { text: 'hi', itemId: ITEM_ID }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects sending into a CLOSED conversation', async () => {
    mockConversations.resolveItemForUser.mockResolvedValue(buildItem());
    mockPrisma.conversation.findUnique.mockResolvedValue(
      buildConversation({ status: ConversationStatus.CLOSED }),
    );

    await expect(
      service.sendText(DRIVER_USER, CONVERSATION_ID, { text: 'hi', itemId: ITEM_ID }),
    ).rejects.toThrow(ConflictException);
  });

  it('404s when the conversation is in a different vendor than the caller', async () => {
    mockConversations.resolveItemForUser.mockResolvedValue(buildItem());
    mockPrisma.conversation.findUnique.mockResolvedValue(
      buildConversation({ vendorId: 'other-vendor' }),
    );

    await expect(
      service.sendText(DRIVER_USER, CONVERSATION_ID, { text: 'hi', itemId: ITEM_ID }),
    ).rejects.toThrow(NotFoundException);
  });

  it('stamps the message with the passed item and refreshes the conversation rollup from it', async () => {
    const item = buildItem();
    mockConversations.resolveItemForUser.mockResolvedValue(item);
    mockPrisma.conversation.findUnique.mockResolvedValue(buildConversation());
    mockPrisma.conversationMessage.create.mockResolvedValue({
      id: 'msg-1',
      createdAt: new Date('2026-07-17T10:00:00.000Z'),
    });
    mockPrisma.conversation.update.mockResolvedValue({});

    await service.sendText(DRIVER_USER, CONVERSATION_ID, { text: 'on my way', itemId: ITEM_ID });

    expect(mockPrisma.conversationMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ dailySheetItemId: item.id }) }),
    );
    expect(mockPrisma.conversation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: CONVERSATION_ID },
        data: expect.objectContaining({
          messageCount: { increment: 1 },
          dailySheetItemId: item.id,
          dailySheetId: item.dailySheetId,
          vanId: item.dailySheet.vanId,
          driverId: item.dailySheet.driverId,
          deliveryDate: item.dailySheet.date,
        }),
      }),
    );
  });

  it('auto-reopens a RESOLVED conversation on a new message', async () => {
    mockConversations.resolveItemForUser.mockResolvedValue(buildItem());
    mockPrisma.conversation.findUnique.mockResolvedValue(
      buildConversation({ status: ConversationStatus.RESOLVED }),
    );
    mockPrisma.conversationMessage.create.mockResolvedValue({
      id: 'msg-1',
      createdAt: new Date('2026-07-17T10:00:00.000Z'),
    });
    mockPrisma.conversation.update.mockResolvedValue({});

    await service.sendText(DRIVER_USER, CONVERSATION_ID, { text: 'reply', itemId: ITEM_ID });

    expect(mockPrisma.conversation.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: ConversationStatus.OPEN }) }),
    );
  });
});
