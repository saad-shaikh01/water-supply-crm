import {
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  TicketPriority,
  TicketStatus,
  TicketType,
} from '@prisma/client';
import { FcmService } from '../fcm/fcm.service';
import { NotificationService } from '../notifications/notification.service';
import { TicketService } from './ticket.service';
import {
  createMockCustomer,
  createPrismaMock,
  createPrismaProvider,
  createTestModule,
  mockVendorId,
  PrismaMock,
} from '../../../test';

describe('TicketService', () => {
  let service: TicketService;
  let prisma: PrismaMock;
  let notifications: {
    queueWhatsApp: jest.Mock;
    queueFcm: jest.Mock;
  };
  let fcm: {
    sendToVendorUsers: jest.Mock;
  };

  const customer = createMockCustomer({
    id: 'customer-1',
    vendorId: mockVendorId,
    userId: 'user-1',
    name: 'Ali Khan',
    phoneNumber: '03001234567',
  });

  beforeEach(async () => {
    prisma = createPrismaMock();
    notifications = {
      queueWhatsApp: jest.fn().mockResolvedValue(undefined),
      queueFcm: jest.fn().mockResolvedValue(undefined),
    };
    fcm = {
      sendToVendorUsers: jest.fn().mockResolvedValue({ sent: 1, failed: 0 }),
    };

    const module = await createTestModule({
      providers: [
        TicketService,
        createPrismaProvider(prisma),
        { provide: NotificationService, useValue: notifications },
        { provide: FcmService, useValue: fcm },
      ],
    });

    service = module.get(TicketService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createTicket', () => {
    it('creates a ticket for the scoped customer using the live default priority', async () => {
      prisma.customer.findFirst.mockResolvedValue(customer as never);
      prisma.customerTicket.create.mockResolvedValue(
        {
          id: 'ticket-1',
          vendorId: mockVendorId,
          customerId: 'customer-1',
          type: TicketType.COMPLAINT,
          subject: 'Water quality issue',
          description: 'The water had an unusual taste today.',
          priority: TicketPriority.NORMAL,
          status: TicketStatus.OPEN,
        } as never,
      );

      const result = await service.createTicket('user-1', {
        type: TicketType.COMPLAINT,
        subject: 'Water quality issue',
        description: 'The water had an unusual taste today.',
      });

      expect(prisma.customerTicket.create).toHaveBeenCalledWith({
        data: {
          vendorId: mockVendorId,
          customerId: 'customer-1',
          type: TicketType.COMPLAINT,
          subject: 'Water quality issue',
          description: 'The water had an unusual taste today.',
          priority: TicketPriority.NORMAL,
        },
      });
      expect(result.status).toBe(TicketStatus.OPEN);
    });

    it('throws ForbiddenException when the user has no linked customer record', async () => {
      prisma.customer.findFirst.mockResolvedValue(null);

      await expect(
        service.createTicket('user-1', {
          type: TicketType.COMPLAINT,
          subject: 'Water quality issue',
          description: 'The water had an unusual taste today.',
        }),
      ).rejects.toThrow(
        new ForbiddenException('No customer account linked to this user'),
      );
    });
  });

  describe('createTicketMessage', () => {
    it('adds a threaded customer message and stores attachments as JSON', async () => {
      prisma.customer.findFirst.mockResolvedValue(customer as never);
      prisma.customerTicket.findUnique.mockResolvedValue(
        {
          id: 'ticket-1',
          customerId: 'customer-1',
        } as never,
      );
      prisma.ticketMessage.create.mockResolvedValue(
        {
          id: 'msg-1',
          ticketId: 'ticket-1',
          senderRole: 'CUSTOMER',
          senderId: 'customer-1',
          message: 'See attached images',
          attachments: [{ key: 'attachments/photo.jpg' }],
        } as never,
      );

      await service.createTicketMessage('user-1', 'ticket-1', {
        message: 'See attached images',
        attachments: [{ key: 'attachments/photo.jpg' }],
      });

      expect(prisma.ticketMessage.create).toHaveBeenCalledWith({
        data: {
          ticketId: 'ticket-1',
          senderRole: 'CUSTOMER',
          senderId: 'customer-1',
          message: 'See attached images',
          attachments: [{ key: 'attachments/photo.jpg' }],
        },
      });
    });

    it('throws NotFoundException when the ticket is outside the customer scope', async () => {
      prisma.customer.findFirst.mockResolvedValue(customer as never);
      prisma.customerTicket.findUnique.mockResolvedValue(
        {
          id: 'ticket-1',
          customerId: 'other-customer',
        } as never,
      );

      await expect(
        service.createTicketMessage('user-1', 'ticket-1', {
          message: 'Need help',
        }),
      ).rejects.toThrow(new NotFoundException('Ticket not found'));
    });
  });

  describe('getTicketMessages', () => {
    it('returns the thread in ascending createdAt order for the customer view', async () => {
      prisma.customer.findFirst.mockResolvedValue(customer as never);
      prisma.customerTicket.findUnique.mockResolvedValue(
        {
          id: 'ticket-1',
          customerId: 'customer-1',
        } as never,
      );
      prisma.ticketMessage.findMany.mockResolvedValue([] as never);

      await service.getTicketMessages('user-1', 'ticket-1');

      expect(prisma.ticketMessage.findMany).toHaveBeenCalledWith({
        where: { ticketId: 'ticket-1' },
        orderBy: { createdAt: 'asc' },
      });
    });
  });

  describe('replyToTicket', () => {
    it('stores a vendor reply without overwriting existing resolution metadata when still open', async () => {
      prisma.customerTicket.findUnique.mockResolvedValue(
        {
          id: 'ticket-1',
          vendorId: mockVendorId,
          subject: 'Water quality issue',
          status: TicketStatus.OPEN,
          resolvedBy: null,
          resolvedAt: null,
          customer: {
            id: 'customer-1',
            name: 'Ali Khan',
            phoneNumber: '03001234567',
            userId: 'user-1',
          },
        } as never,
      );
      prisma.customerTicket.update.mockResolvedValue(
        {
          id: 'ticket-1',
          status: TicketStatus.OPEN,
          vendorReply: 'We are checking this issue.',
        } as never,
      );

      await service.replyToTicket(mockVendorId, 'ticket-1', 'staff-1', {
        vendorReply: 'We are checking this issue.',
      });

      expect(prisma.customerTicket.update).toHaveBeenCalledWith({
        where: { id: 'ticket-1' },
        data: {
          vendorReply: 'We are checking this issue.',
          status: TicketStatus.OPEN,
          resolvedBy: null,
          resolvedAt: null,
        },
      });
    });

    it('marks the ticket resolved and sets resolver metadata on the first resolve transition', async () => {
      prisma.customerTicket.findUnique.mockResolvedValue(
        {
          id: 'ticket-1',
          vendorId: mockVendorId,
          subject: 'Water quality issue',
          status: TicketStatus.OPEN,
          resolvedBy: null,
          resolvedAt: null,
          customer: {
            id: 'customer-1',
            name: 'Ali Khan',
            phoneNumber: '03001234567',
            userId: 'user-1',
          },
        } as never,
      );
      prisma.customerTicket.update.mockResolvedValue(
        {
          id: 'ticket-1',
          status: TicketStatus.RESOLVED,
          vendorReply: 'Issue fixed.',
          resolvedBy: 'staff-1',
        } as never,
      );

      await service.replyToTicket(mockVendorId, 'ticket-1', 'staff-1', {
        vendorReply: 'Issue fixed.',
        status: TicketStatus.RESOLVED,
      });
      await Promise.resolve();

      expect(prisma.customerTicket.update).toHaveBeenCalledWith({
        where: { id: 'ticket-1' },
        data: {
          vendorReply: 'Issue fixed.',
          status: TicketStatus.RESOLVED,
          resolvedBy: 'staff-1',
          resolvedAt: expect.any(Date),
        },
      });
      expect(notifications.queueFcm).toHaveBeenCalledWith(
        'user-1',
        expect.stringContaining('Resolved'),
        expect.stringContaining('resolved'),
        expect.objectContaining({
          type: 'TICKET_RESOLVED',
          ticketId: 'ticket-1',
        }),
        expect.stringMatching(/TICKET_RESOLVED|ticket\.resolved/),
      );
    });

    it('throws NotFoundException when the vendor does not own the ticket', async () => {
      prisma.customerTicket.findUnique.mockResolvedValue(
        {
          id: 'ticket-1',
          vendorId: 'other-vendor',
          customer: {
            id: 'customer-1',
            name: 'Ali Khan',
            phoneNumber: '03001234567',
            userId: 'user-1',
          },
        } as never,
      );

      await expect(
        service.replyToTicket(mockVendorId, 'ticket-1', 'staff-1', {
          vendorReply: 'We are checking this issue.',
        }),
      ).rejects.toThrow(new NotFoundException('Ticket not found'));
    });
  });
});
