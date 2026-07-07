import { Controller, Get, Patch, Body, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { NotificationSettingsService } from './notification-settings.service';
import { UpdateNotificationSettingDto } from './dto/update-notification-setting.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '@water-supply-crm/types';

/**
 * Vendor-level master switches for notification flows (per channel).
 * Distinct from /notifications/preferences (per-user opt-in) — this decides
 * whether a flow is emitted at all for the vendor's customers.
 */
@Controller('notification-settings')
@UseGuards(JwtAuthGuard, RolesGuard)
export class NotificationSettingsController {
  constructor(private readonly settings: NotificationSettingsService) {}

  /** GET /notification-settings — full type × channel matrix. */
  @Get()
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF)
  getMatrix(@CurrentUser() user: AuthUser) {
    return this.settings.getMatrix(user.vendorId);
  }

  /** PATCH /notification-settings — toggle one flow on a channel. */
  @Patch()
  @Roles(UserRole.VENDOR_ADMIN)
  update(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateNotificationSettingDto,
  ) {
    return this.settings.setSetting(user.vendorId, dto.type, dto.channel, dto.enabled);
  }
}
