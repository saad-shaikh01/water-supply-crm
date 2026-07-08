import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { extname } from 'path';
import { Throttle } from '@nestjs/throttler';
import { TicketService } from './ticket.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { TicketQueryDto } from './dto/ticket-query.dto';
import { CreateTicketMessageDto } from './dto/create-ticket-message.dto';
import { RequireCustomer } from '../../common/decorators/authz-markers.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '@water-supply-crm/types';
import { StorageService } from '../../common/storage/storage.service';

const ALLOWED_ATTACHMENT_EXTS = [
  '.jpg', '.jpeg', '.png', '.webp', '.gif',
  '.pdf', '.doc', '.docx', '.txt',
];

@Controller('portal/tickets')
@RequireCustomer()
export class TicketPortalController {
  constructor(
    private readonly ticketService: TicketService,
    private readonly storage: StorageService,
  ) {}

  // ── Static routes must be declared before parameterised /:id routes ──────

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateTicketDto) {
    return this.ticketService.createTicket(user.userId, dto);
  }

  @Get()
  findAll(@CurrentUser() user: AuthUser, @Query() query: TicketQueryDto) {
    return this.ticketService.getCustomerTickets(user.userId, query);
  }

  /**
   * POST /portal/tickets/upload-attachment
   * Upload a single file to Wasabi.
   * Returns { key, name } — the key is stored in the message's attachments JSON.
   * Max size: 10 MB. Allowed: images, PDF, DOC, TXT.
   */
  @Post('upload-attachment')
  @Throttle({ short: { ttl: 2000, limit: 5 }, medium: { ttl: 60000, limit: 20 } })
  @UseInterceptors(
    FileInterceptor('attachment', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
      fileFilter: (_req, file, cb) => {
        if (ALLOWED_ATTACHMENT_EXTS.includes(extname(file.originalname).toLowerCase())) {
          cb(null, true);
        } else {
          cb(new Error('File type not allowed for ticket attachments'), false);
        }
      },
    }),
  )
  async uploadAttachment(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file provided');
    const { key } = await this.storage.upload(
      'ticket-attachments',
      file.buffer,
      file.originalname,
      file.mimetype,
    );
    return { key, name: file.originalname };
  }

  /**
   * GET /portal/tickets/attachment-url?key=ticket-attachments/uuid.ext
   * Generate a short-lived signed URL (15 min) for a ticket attachment.
   * Verifies the key belongs to a message on this customer's ticket before signing.
   * Returns { signedUrl }.
   */
  @Get('attachment-url')
  getAttachmentUrl(@CurrentUser() user: AuthUser, @Query('key') key: string) {
    return this.ticketService.getSignedAttachmentUrl(user.userId, key);
  }

  // ── Parameterised /:id routes ─────────────────────────────────────────────

  @Get(':id')
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.ticketService.getCustomerTicketById(user.userId, id);
  }

  @Get(':id/messages')
  getMessages(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.ticketService.getTicketMessages(user.userId, id);
  }

  @Post(':id/messages')
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 30 } })
  createMessage(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreateTicketMessageDto,
  ) {
    return this.ticketService.createTicketMessage(user.userId, id, dto);
  }
}
