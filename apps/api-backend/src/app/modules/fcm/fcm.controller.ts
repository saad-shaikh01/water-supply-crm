import {
  Controller,
  Post,
  Delete,
  Get,
  Body,
} from '@nestjs/common';
import { FcmService } from './fcm.service';
import { RegisterFcmTokenDto } from './dto/register-fcm-token.dto';
import { AuthenticatedOnly } from '../../common/decorators/authz-markers.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '@water-supply-crm/types';

// Self-service: any authenticated user registers/lists their own device tokens.
@Controller('fcm')
@AuthenticatedOnly()
export class FcmController {
  constructor(private readonly fcmService: FcmService) {}

  @Post('token')
  register(@CurrentUser() user: AuthUser, @Body() dto: RegisterFcmTokenDto) {
    return this.fcmService.registerToken(user.userId, dto.token, dto.platform);
  }

  @Delete('token')
  deleteToken(@Body() body: { token: string }) {
    return this.fcmService.deleteToken(body.token);
  }

  @Get('tokens')
  listTokens(@CurrentUser() user: AuthUser) {
    return this.fcmService.getTokensForUser(user.userId);
  }
}
