import {
  Controller,
  Post,
  Delete,
  Get,
  Body,
  UseGuards,
} from '@nestjs/common';
import { FcmService } from './fcm.service';
import { RegisterFcmTokenDto } from './dto/register-fcm-token.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('fcm')
@UseGuards(JwtAuthGuard)
export class FcmController {
  constructor(private readonly fcmService: FcmService) {}

  @Post('token')
  register(@CurrentUser() user: any, @Body() dto: RegisterFcmTokenDto) {
    return this.fcmService.registerToken(user.userId, dto.token, dto.platform);
  }

  @Delete('token')
  deleteToken(@Body() body: { token: string }) {
    return this.fcmService.deleteToken(body.token);
  }

  @Get('tokens')
  listTokens(@CurrentUser() user: any) {
    return this.fcmService.getTokensForUser(user.userId);
  }
}
