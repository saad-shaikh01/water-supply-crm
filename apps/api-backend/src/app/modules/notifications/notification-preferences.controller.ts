import { Controller, Get, Patch, Body } from '@nestjs/common';
import { NotificationPreferenceService } from './notification-preference.service';
import { UpsertPreferenceDto } from './dto/upsert-preference.dto';
import { AuthenticatedOnly } from '../../common/decorators/authz-markers.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '@water-supply-crm/types';

/**
 * Notification preferences for any authenticated user (CUSTOMER or vendor staff).
 * Keyed by userId + eventType + channel — any authenticated user manages their own prefs.
 */
@Controller('notifications/preferences')
@AuthenticatedOnly()
export class NotificationPreferencesController {
  constructor(private readonly prefService: NotificationPreferenceService) {}

  /**
   * GET /notifications/preferences
   * List all notification preferences for the current user.
   */
  @Get()
  getPreferences(@CurrentUser() user: AuthUser) {
    return this.prefService.getPreferences(user.userId);
  }

  /**
   * PATCH /notifications/preferences
   * Create or update a preference for a specific eventType + channel.
   */
  @Patch()
  upsertPreference(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpsertPreferenceDto,
  ) {
    return this.prefService.upsertPreference(user.userId, dto);
  }
}
