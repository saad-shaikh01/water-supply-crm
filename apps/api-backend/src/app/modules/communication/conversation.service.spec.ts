import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { ConversationService } from './conversation.service';
import { AuditService } from '../audit/audit.service';
import { UserRole } from '@prisma/client';
import type { AuthUser } from '@water-supply-crm/types';

/**
 * Unit tests for the Communication Center's per-customer redesign
 * (2026-07-17): Conversation is keyed on (vendorId, customerId) instead of
 * one row per DailySheetItem. Focus:
 *  - get-or-create is idempotent per customer regardless of which item opened it.
 *  - the inbox hides empty (zero-message) conversations.
 *  - DRIVER read access is history-based (resolveConversationForUser) but
 *    falls back to item-scoped when an itemId is known (resolveConversationForRead) —
 *    the item-scoped path must work even with zero prior message history.
 */
describe('ConversationService', () => {
  let service: ConversationService;
  let mockPrisma: any;

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

  const STAFF_USER: AuthUser = {
    userId: 'staff-1',
    email: 's@example.com',
    name: 'Staff',
    role: UserRole.STAFF,
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
        vendorId: VENDOR_ID,
        vanId: 'van-001',
        driverId: DRIVER_USER.userId,
        date: new Date('2026-07-17T00:00:00.000Z'),
      },
      ...overrides,
    };
  }

  beforeEach(async () => {
    mockPrisma = {
      dailySheetItem: { findUnique: jest.fn() },
      conversation: {
        findUnique: jest.fn(),
        upsert: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
      },
      conversationMessage: { findFirst: jest.fn(), count: jest.fn() },
      conversationRead: { findMany: jest.fn().mockResolvedValue([]), upsert: jest.fn() },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConversationService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: { log: jest.fn() } },
      ],
    }).compile();

    service = module.get(ConversationService);
  });

  describe('getOrCreateForItem', () => {
    it('upserts on (vendorId, customerId), not on the item', async () => {
      mockPrisma.dailySheetItem.findUnique.mockResolvedValue(buildItem());
      mockPrisma.conversation.upsert.mockResolvedValue({
        id: CONVERSATION_ID,
        lastMessageSenderRole: null,
      });

      await service.getOrCreateForItem(STAFF_USER, ITEM_ID);

      expect(mockPrisma.conversation.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { vendorId_customerId: { vendorId: VENDOR_ID, customerId: CUSTOMER_ID } },
          update: {},
          create: { vendorId: VENDOR_ID, customerId: CUSTOMER_ID },
        }),
      );
    });

    it('is idempotent: a second item for the same customer resolves to the same conversation', async () => {
      const secondItemId = 'item-002';
      mockPrisma.dailySheetItem.findUnique
        .mockResolvedValueOnce(buildItem())
        .mockResolvedValueOnce(buildItem({ id: secondItemId }));
      mockPrisma.conversation.upsert.mockResolvedValue({
        id: CONVERSATION_ID,
        lastMessageSenderRole: null,
      });

      const first = await service.getOrCreateForItem(STAFF_USER, ITEM_ID);
      const second = await service.getOrCreateForItem(STAFF_USER, secondItemId);

      expect(first.id).toBe(CONVERSATION_ID);
      expect(second.id).toBe(CONVERSATION_ID);
      expect(mockPrisma.conversation.upsert).toHaveBeenCalledTimes(2);
    });

    it('denies a DRIVER opening an item on a sheet they no longer drive', async () => {
      mockPrisma.dailySheetItem.findUnique.mockResolvedValue(
        buildItem({ dailySheet: { ...buildItem().dailySheet, driverId: 'other-driver' } }),
      );

      await expect(service.getOrCreateForItem(DRIVER_USER, ITEM_ID)).rejects.toThrow(NotFoundException);
    });
  });

  describe('findMany', () => {
    it('always filters out empty (zero-message) conversations', async () => {
      mockPrisma.conversation.count.mockResolvedValue(0);
      mockPrisma.conversation.findMany.mockResolvedValue([]);

      await service.findMany(STAFF_USER, {} as any);

      expect(mockPrisma.conversation.count).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ messageCount: { gt: 0 } }) }),
      );
    });

    it('scopes DRIVER rows by message history, not the (removed) item relation', async () => {
      mockPrisma.conversation.count.mockResolvedValue(0);
      mockPrisma.conversation.findMany.mockResolvedValue([]);

      await service.findMany(DRIVER_USER, {} as any);

      const whereArg = mockPrisma.conversation.count.mock.calls[0][0].where;
      expect(whereArg.messages).toEqual({
        some: { item: { dailySheet: { driverId: DRIVER_USER.userId } } },
      });
      expect(whereArg.item).toBeUndefined();
    });
  });

  describe('resolveConversationForUser (history-based)', () => {
    it('denies a DRIVER with no message history in this conversation', async () => {
      mockPrisma.conversation.findUnique.mockResolvedValue({ id: CONVERSATION_ID, vendorId: VENDOR_ID });
      mockPrisma.conversationMessage.findFirst.mockResolvedValue(null);

      await expect(service.resolveConversationForUser(DRIVER_USER, CONVERSATION_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('allows a DRIVER who has previously messaged in this conversation', async () => {
      mockPrisma.conversation.findUnique.mockResolvedValue({ id: CONVERSATION_ID, vendorId: VENDOR_ID });
      mockPrisma.conversationMessage.findFirst.mockResolvedValue({ id: 'msg-1' });

      await expect(service.resolveConversationForUser(DRIVER_USER, CONVERSATION_ID)).resolves.toBeTruthy();
    });
  });

  describe('resolveConversationForRead (item-scoped fallback)', () => {
    it('lets a DRIVER read a brand-new thread via their current item, with zero message history', async () => {
      mockPrisma.dailySheetItem.findUnique.mockResolvedValue(buildItem());
      mockPrisma.conversation.findUnique.mockResolvedValue({
        id: CONVERSATION_ID,
        vendorId: VENDOR_ID,
        customerId: CUSTOMER_ID,
      });
      // No message-history check should even run for this path.
      mockPrisma.conversationMessage.findFirst.mockResolvedValue(null);

      await expect(
        service.resolveConversationForRead(DRIVER_USER, CONVERSATION_ID, ITEM_ID),
      ).resolves.toBeTruthy();
      expect(mockPrisma.conversationMessage.findFirst).not.toHaveBeenCalled();
    });

    it('rejects when the item belongs to a different customer than the conversation', async () => {
      mockPrisma.dailySheetItem.findUnique.mockResolvedValue(buildItem());
      mockPrisma.conversation.findUnique.mockResolvedValue({
        id: CONVERSATION_ID,
        vendorId: VENDOR_ID,
        customerId: 'some-other-customer',
      });

      await expect(
        service.resolveConversationForRead(DRIVER_USER, CONVERSATION_ID, ITEM_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('falls back to the history-based check when no itemId is given', async () => {
      mockPrisma.conversation.findUnique.mockResolvedValue({ id: CONVERSATION_ID, vendorId: VENDOR_ID });
      mockPrisma.conversationMessage.findFirst.mockResolvedValue(null);

      await expect(service.resolveConversationForRead(DRIVER_USER, CONVERSATION_ID)).rejects.toThrow(
        NotFoundException,
      );
      expect(mockPrisma.conversationMessage.findFirst).toHaveBeenCalled();
    });
  });
});
