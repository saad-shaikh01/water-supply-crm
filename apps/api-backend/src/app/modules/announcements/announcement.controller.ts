import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { AuthUser } from '@water-supply-crm/types';
import { RequireSuperAdmin } from '../../common/decorators/authz-markers.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AnnouncementService } from './announcement.service';
import { CreateAnnouncementDto, ListAnnouncementsQueryDto, UpdateAnnouncementDto } from './dto/announcement.dto';

// Platform surface — super-admin only.
@Controller('platform/announcements')
@RequireSuperAdmin()
export class AnnouncementController {
  constructor(private readonly announcements: AnnouncementService) {}

  @Get()
  list(@Query() query: ListAnnouncementsQueryDto) {
    return this.announcements.list(query);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.announcements.findOne(id);
  }

  @Get(':id/stats')
  stats(@Param('id', ParseUUIDPipe) id: string) {
    return this.announcements.stats(id);
  }

  @Post()
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 20 } })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateAnnouncementDto) {
    return this.announcements.create(dto, user);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAnnouncementDto) {
    return this.announcements.update(id, dto, user);
  }

  @Post(':id/send')
  @Throttle({ short: { ttl: 1000, limit: 2 }, medium: { ttl: 60000, limit: 10 } })
  send(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.announcements.send(id, user);
  }

  @Post(':id/cancel')
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.announcements.cancel(id, user);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.announcements.remove(id, user);
  }
}
