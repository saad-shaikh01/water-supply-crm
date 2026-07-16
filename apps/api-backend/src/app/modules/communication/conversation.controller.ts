import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Throttle } from '@nestjs/throttler';
import { ConversationService } from './conversation.service';
import { MessageService } from './message.service';
import { ConversationQueryDto } from './dto/conversation-query.dto';
import { MessagesQueryDto } from './dto/messages-query.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { UpdateConversationStatusDto } from './dto/update-conversation-status.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '@water-supply-crm/types';

// Same audio contract as the legacy voice-note endpoint.
const ALLOWED_AUDIO_MIMES = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/x-m4a'];

@Controller('conversations')
export class ConversationController {
  constructor(
    private readonly conversationService: ConversationService,
    private readonly messageService: MessageService,
  ) {}

  // ── Static routes MUST come before /:id ──────────────────────────────

  /**
   * PUT /conversations/for-item/:itemId
   * Idempotent get-or-create — the single entry seam from a delivery card
   * (and, later, from the Collection Policy validation screen).
   */
  @Put('for-item/:itemId')
  @RequirePermissions('conversations:create')
  @Throttle({ short: { ttl: 1000, limit: 10 }, medium: { ttl: 60000, limit: 60 } })
  getOrCreateForItem(@CurrentUser() user: AuthUser, @Param('itemId') itemId: string) {
    return this.conversationService.getOrCreateForItem(user, itemId);
  }

  @Get('unread-count')
  @RequirePermissions('conversations:view')
  getUnreadCount(@CurrentUser() user: AuthUser) {
    return this.conversationService.getUnreadCount(user);
  }

  @Get()
  @RequirePermissions('conversations:view')
  findMany(@CurrentUser() user: AuthUser, @Query() query: ConversationQueryDto) {
    return this.conversationService.findMany(user, query);
  }

  @Get(':id')
  @RequirePermissions('conversations:view')
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.conversationService.findOne(user, id);
  }

  @Get(':id/messages')
  @RequirePermissions('conversations:view')
  getMessages(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query() query: MessagesQueryDto,
  ) {
    return this.messageService.getMessages(user, id, query);
  }

  @Post(':id/messages')
  @RequirePermissions('conversations:send')
  @Throttle({ short: { ttl: 1000, limit: 10 }, medium: { ttl: 60000, limit: 30 } })
  sendText(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.messageService.sendText(user, id, dto);
  }

  @Post(':id/messages/voice')
  @RequirePermissions('conversations:send')
  @Throttle({ short: { ttl: 2000, limit: 5 }, medium: { ttl: 60000, limit: 20 } })
  @UseInterceptors(
    FileInterceptor('audio', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
      fileFilter: (_req, file, cb) => {
        if (ALLOWED_AUDIO_MIMES.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new Error('File type not allowed. Send audio/webm, audio/ogg, audio/mp4, or audio/mpeg.'), false);
        }
      },
    }),
  )
  async sendVoice(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @UploadedFile() file?: Express.Multer.File,
    @Query('duration') duration?: string,
    @Query('requiresAck') requiresAck?: string,
  ) {
    if (!file) throw new BadRequestException('No audio file provided');
    const parsedDuration = duration ? parseInt(duration, 10) : undefined;
    const audioDuration =
      parsedDuration != null && Number.isFinite(parsedDuration) && parsedDuration >= 0
        ? parsedDuration
        : undefined;
    return this.messageService.sendVoice(user, id, file, audioDuration, requiresAck === 'true');
  }

  @Patch(':id/read')
  @RequirePermissions('conversations:acknowledge')
  @Throttle({ short: { ttl: 1000, limit: 20 }, medium: { ttl: 60000, limit: 120 } })
  markRead(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.conversationService.markRead(user, id);
  }

  @Patch(':id/status')
  @RequirePermissions('conversations:manage_status')
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 30 } })
  updateStatus(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateConversationStatusDto,
  ) {
    return this.conversationService.updateStatus(user, id, dto.status);
  }
}
