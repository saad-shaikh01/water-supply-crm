import { Controller, Get, Patch, Body } from '@nestjs/common';
import { NotificationSettingsService } from './notification-settings.service';
import { UpdateNotificationSettingDto } from './dto/update-notification-setting.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '@water-supply-crm/types';

/**
 * Vendor-level master switches for notification flows (per channel).
 * Distinct from /notifications/preferences (per-user opt-in).
 */
@Controller('notification-settings')
export class NotificationSettingsController {
  constructor(private readonly settings: NotificationSettingsService) {}

  /** GET /notification-settings — full type × channel matrix. */
  @Get()
  @RequirePermissions('notifications:view')
  getMatrix(@CurrentUser() user: AuthUser) {
    return this.settings.getMatrix(user.vendorId);
  }

  /** PATCH /notification-settings — toggle one flow on a channel. */
  @Patch()
  @RequirePermissions('notifications:configure')
  update(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateNotificationSettingDto,
  ) {
    return this.settings.setSetting(user.vendorId, dto.type, dto.channel, dto.enabled);
  }
}
