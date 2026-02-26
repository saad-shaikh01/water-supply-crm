import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { paginate } from '../../common/helpers/paginate';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { ReplyTicketDto } from './dto/reply-ticket.dto';
import { TicketQueryDto } from './dto/ticket-query.dto';
import { CreateTicketMessageDto } from './dto/create-ticket-message.dto';

@Injectable()
export class TicketService {
  constructor(private prisma: PrismaService) {}

  private async getCustomer(userId: string) {
    const customer = await this.prisma.customer.findFirst({ where: { userId } });
    if (!customer) throw new ForbiddenException('No customer account linked to this user');
    return customer;
  }

  async createTicket(userId: string, dto: CreateTicketDto) {
    const customer = await this.getCustomer(userId);
    return this.prisma.customerTicket.create({
      data: {
        vendorId: customer.vendorId,
        customerId: customer.id,
        type: dto.type,
        subject: dto.subject,
        description: dto.description,
        priority: dto.priority ?? 'NORMAL',
      },
    });
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
    const ticket = await this.prisma.customerTicket.findUnique({ where: { id: ticketId } });
    if (!ticket || ticket.vendorId !== vendorId) throw new NotFoundException('Ticket not found');

    const newStatus = dto.status ?? ticket.status;
    const isResolving = newStatus === 'RESOLVED' && ticket.status !== 'RESOLVED';

    return this.prisma.customerTicket.update({
      where: { id: ticketId },
      data: {
        vendorReply: dto.vendorReply,
        status: newStatus,
        resolvedBy: isResolving ? userId : ticket.resolvedBy,
        resolvedAt: isResolving ? new Date() : ticket.resolvedAt,
      },
    });
  }
}
