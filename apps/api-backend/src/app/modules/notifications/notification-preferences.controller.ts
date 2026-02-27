import { Controller, Get, Patch, Body, UseGuards } from '@nestjs/common';
import { NotificationPreferenceService } from './notification-preference.service';
import { UpsertPreferenceDto } from './dto/upsert-preference.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

/**
 * Notification preferences for any authenticated user (CUSTOMER or vendor staff).
 * Keyed by userId + eventType + channel — any authenticated user manages their own prefs.
 */
@Controller('notifications/preferences')
@UseGuards(JwtAuthGuard)
export class NotificationPreferencesController {
  constructor(private readonly prefService: NotificationPreferenceService) {}

  /**
   * GET /notifications/preferences
   * List all notification preferences for the current user.
   */
  @Get()
  getPreferences(@CurrentUser() user: any) {
    return this.prefService.getPreferences(user.userId);
  }

  /**
   * PATCH /notifications/preferences
   * Create or update a preference for a specific eventType + channel.
   */
  @Patch()
  upsertPreference(
    @CurrentUser() user: any,
    @Body() dto: UpsertPreferenceDto,
  ) {
    return this.prefService.upsertPreference(user.userId, dto);
  }
}
