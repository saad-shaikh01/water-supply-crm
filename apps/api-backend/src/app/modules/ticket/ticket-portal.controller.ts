import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { extname } from 'path';
import { Throttle } from '@nestjs/throttler';
import { UserRole } from '@prisma/client';
import { TicketService } from './ticket.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { TicketQueryDto } from './dto/ticket-query.dto';
import { CreateTicketMessageDto } from './dto/create-ticket-message.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { StorageService } from '../../common/storage/storage.service';

const ALLOWED_ATTACHMENT_EXTS = [
  '.jpg', '.jpeg', '.png', '.webp', '.gif',
  '.pdf', '.doc', '.docx', '.txt',
];

@Controller('portal/tickets')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.CUSTOMER)
export class TicketPortalController {
  constructor(
    private readonly ticketService: TicketService,
    private readonly storage: StorageService,
  ) {}

  @Post()
  create(@CurrentUser() user: any, @Body() dto: CreateTicketDto) {
    return this.ticketService.createTicket(user.userId, dto);
  }

  @Get()
  findAll(@CurrentUser() user: any, @Query() query: TicketQueryDto) {
    return this.ticketService.getCustomerTickets(user.userId, query);
  }

  @Get(':id')
  findOne(@CurrentUser() user: any, @Param('id') id: string) {
    return this.ticketService.getCustomerTicketById(user.userId, id);
  }

  @Get(':id/messages')
  getMessages(@CurrentUser() user: any, @Param('id') id: string) {
    return this.ticketService.getTicketMessages(user.userId, id);
  }

  @Post(':id/messages')
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 30 } })
  createMessage(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: CreateTicketMessageDto,
  ) {
    return this.ticketService.createTicketMessage(user.userId, id, dto);
  }

  /**
   * POST /portal/tickets/upload-attachment
   * Upload a single file to Wasabi and return the object key + URL.
   * The frontend uses the returned URL when composing a ticket message.
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
    const { key, url } = await this.storage.upload(
      'ticket-attachments',
      file.buffer,
      file.originalname,
      file.mimetype,
    );
    return { key, url, name: file.originalname };
  }
}
