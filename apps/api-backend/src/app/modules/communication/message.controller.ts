import { Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { UserRole } from '@prisma/client';
import { MessageService } from './message.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '@water-supply-crm/types';

@Controller('messages')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MessageController {
  constructor(private readonly messageService: MessageService) {}

  @Patch(':id/acknowledge')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF, UserRole.DRIVER)
  @Throttle({ short: { ttl: 1000, limit: 20 }, medium: { ttl: 60000, limit: 60 } })
  acknowledge(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.messageService.acknowledge(user, id);
  }

  @Get(':id/audio')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF, UserRole.DRIVER)
  getAudioUrl(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.messageService.getAudioUrl(user.vendorId, id);
  }
}
