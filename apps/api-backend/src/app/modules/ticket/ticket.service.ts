import { Injectable, NotFoundException, ForbiddenException, Logger } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { paginate } from '../../common/helpers/paginate';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { ReplyTicketDto } from './dto/reply-ticket.dto';
import { TicketQueryDto } from './dto/ticket-query.dto';
import { CreateTicketMessageDto } from './dto/create-ticket-message.dto';
import { NotificationService } from '../notifications/notification.service';
import { FcmService } from '../fcm/fcm.service';
import { NOTIFICATION_EVENTS } from '@water-supply-crm/queue';
import { MessageTemplates } from '../whatsapp/templates/message.templates';

@Injectable()
export class TicketService {
  private readonly logger = new Logger(TicketService.name);

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationService,
    private fcm: FcmService,
  ) {}

  private async getCustomer(userId: string) {
    const customer = await this.prisma.customer.findFirst({ where: { userId } });
    if (!customer) throw new ForbiddenException('No customer account linked to this user');
    return customer;
  }

  async createTicket(userId: string, dto: CreateTicketDto) {
    const customer = await this.getCustomer(userId);
    const ticket = await this.prisma.customerTicket.create({
      data: {
        vendorId: customer.vendorId,
        customerId: customer.id,
        type: dto.type,
        subject: dto.subject,
        description: dto.description,
        priority: dto.priority ?? 'NORMAL',
      },
    });

    // Notify vendor staff via FCM
    this.fcm
      .sendToVendorUsers(
        customer.vendorId,
        'New Support Ticket',
        `${customer.name}: ${dto.subject}`,
        { type: 'TICKET_CREATED', ticketId: ticket.id },
      )
      .catch(() => null);

    return ticket;
  }

  async getCustomerTickets(userId: string, query: TicketQueryDto) {
    const customer = await this.getCustomer(userId);
    const { page = 1, limit = 20, type, status } = query;
    const where: any = { customerId: customer.id };
    if (type) where.type = type;
    if (status) where.status = status;

    const [data, total] = await Promise.all([
      this.prisma.customerTicket.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.customerTicket.count({ where }),
    ]);

    return paginate(data, total, page, limit);
  }

  async getCustomerTicketById(userId: string, ticketId: string) {
    const customer = await this.getCustomer(userId);
    const ticket = await this.prisma.customerTicket.findUnique({ where: { id: ticketId } });
    if (!ticket || ticket.customerId !== customer.id) throw new NotFoundException('Ticket not found');
    return ticket;
  }

  async getVendorTickets(vendorId: string, query: TicketQueryDto) {
    const { page = 1, limit = 20, type, status } = query;
    const where: any = { vendorId };
    if (type) where.type = type;
    if (status) where.status = status;

    const [data, total] = await Promise.all([
      this.prisma.customerTicket.findMany({
        where,
        include: {
          customer: { select: { id: true, name: true, phoneNumber: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.customerTicket.count({ where }),
    ]);

    return paginate(data, total, page, limit);
  }

  async getTicketMessages(userId: string, ticketId: string) {
    const customer = await this.getCustomer(userId);
    const ticket = await this.prisma.customerTicket.findUnique({ where: { id: ticketId } });
    if (!ticket || ticket.customerId !== customer.id) throw new NotFoundException('Ticket not found');

    return this.prisma.ticketMessage.findMany({
      where: { ticketId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async createTicketMessage(
    userId: string,
    ticketId: string,
    dto: CreateTicketMessageDto,
  ) {
    const customer = await this.getCustomer(userId);
    const ticket = await this.prisma.customerTicket.findUnique({ where: { id: ticketId } });
    if (!ticket || ticket.customerId !== customer.id) throw new NotFoundException('Ticket not found');

    return this.prisma.ticketMessage.create({
      data: {
        ticketId,
        senderRole: 'CUSTOMER',
        senderId: customer.id,
        message: dto.message,
        attachments: (dto.attachments as any) ?? [],
      },
    });
  }

  async replyToTicket(vendorId: string, ticketId: string, userId: string, dto: ReplyTicketDto) {
    const ticket = await this.prisma.customerTicket.findUnique({
      where: { id: ticketId },
      include: {
        customer: { select: { id: true, name: true, phoneNumber: true, userId: true } },
      },
    });
    if (!ticket || ticket.vendorId !== vendorId) throw new NotFoundException('Ticket not found');

    const newStatus = dto.status ?? ticket.status;
    const isResolving = newStatus === 'RESOLVED' && ticket.status !== 'RESOLVED';

    const updated = await this.prisma.customerTicket.update({
      where: { id: ticketId },
      data: {
        vendorReply: dto.vendorReply,
        status: newStatus,
        resolvedBy: isResolving ? userId : ticket.resolvedBy,
        resolvedAt: isResolving ? new Date() : ticket.resolvedAt,
      },
    });

    // Notify customer — WhatsApp + FCM
    const event = isResolving ? NOTIFICATION_EVENTS.TICKET_RESOLVED : NOTIFICATION_EVENTS.TICKET_REPLIED;
    const waKey = `ntf:${event}:${ticketId}:wa`;
    const fcmKey = `ntf:${event}:${ticketId}:fcm`;

    const waMsg = MessageTemplates.ticketReplied(ticket.customer.name, ticket.subject);
    this.notifications
      .queueWhatsApp(ticket.customer.phoneNumber, waMsg, waKey)
      .catch((e) => this.logger.warn(`WhatsApp notify failed for ticket ${ticketId}: ${e.message}`));

    if (ticket.customer.userId) {
      this.notifications
        .queueFcm(
          ticket.customer.userId,
          isResolving ? 'Ticket Resolved ✅' : 'New Reply on Your Ticket 💬',
          `Your ticket "${ticket.subject}" has been ${isResolving ? 'resolved' : 'replied to'}.`,
          { type: isResolving ? 'TICKET_RESOLVED' : 'TICKET_REPLIED', ticketId },
          fcmKey,
        )
        .catch(() => null);
    }

    return updated;
  }
}
