import { Controller, Delete, Get, Param, Patch } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { MessageService } from './message.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '@water-supply-crm/types';

@Controller('messages')
export class MessageController {
  constructor(private readonly messageService: MessageService) {}

  @Patch(':id/acknowledge')
  @RequirePermissions('conversations:acknowledge')
  @Throttle({ short: { ttl: 1000, limit: 20 }, medium: { ttl: 60000, limit: 60 } })
  acknowledge(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.messageService.acknowledge(user, id);
  }

  @Delete(':id')
  @RequirePermissions('conversations:send')
  @Throttle({ short: { ttl: 1000, limit: 10 }, medium: { ttl: 60000, limit: 60 } })
  deleteMessage(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.messageService.deleteMessage(user, id);
  }

  @Delete(':id/instruction')
  @RequirePermissions('conversations:send')
  @Throttle({ short: { ttl: 1000, limit: 10 }, medium: { ttl: 60000, limit: 60 } })
  removeInstruction(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.messageService.removeInstruction(user, id);
  }

  @Patch(':id/played')
  @RequirePermissions('conversations:view')
  @Throttle({ short: { ttl: 1000, limit: 20 }, medium: { ttl: 60000, limit: 120 } })
  markPlayed(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.messageService.markPlayed(user, id);
  }

  @Get(':id/audio')
  @RequirePermissions('conversations:view')
  getAudioUrl(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.messageService.getAudioUrl(user.vendorId, id);
  }
}
