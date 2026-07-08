import {
  Controller,
  Post,
  Get,
  Body,
  UnauthorizedException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { Public } from '../../common/decorators/public.decorator';
import { AuthenticatedOnly } from '../../common/decorators/authz-markers.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '@water-supply-crm/types';
import { PermissionService } from '../authz/permission.service';

@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private permissionService: PermissionService,
  ) {}

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({
    short: { ttl: 1000, limit: 3 },
    medium: { ttl: 60000, limit: 5 },
    long: { ttl: 3600000, limit: 20 },
  })
  async login(@Body() loginDto: LoginDto) {
    const user = await this.authService.validateUser(
      loginDto.identifier,
      loginDto.password,
    );
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return this.authService.login(user);
  }

  @Get('me')
  @AuthenticatedOnly()
  async getProfile(@CurrentUser() user: AuthUser) {
    const [profile, permissions] = await Promise.all([
      this.authService.getProfile(user.userId),
      this.permissionService.getEffectivePermissions(user.userId),
    ]);
    return {
      ...profile,
      permissions,
      pagePermissions: permissions.filter((p) => p.endsWith(':page')),
    };
  }

  @Post('forgot-password')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({
    short: { ttl: 1000, limit: 1 },
    medium: { ttl: 60000, limit: 3 },
    long: { ttl: 3600000, limit: 10 },
  })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.authService.generateResetToken(dto.email);
    return { message: 'If the email exists, a reset link has been generated' };
  }

  @Post('reset-password')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({
    short: { ttl: 1000, limit: 1 },
    medium: { ttl: 60000, limit: 5 },
    long: { ttl: 3600000, limit: 10 },
  })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.authService.resetPassword(dto.token, dto.newPassword);
    return { message: 'Password has been reset successfully' };
  }

  /**
   * POST /auth/refresh
   * Exchange a valid refresh token for a new access + refresh token pair.
   * Old refresh token is immediately invalidated (rotation).
   */
  @Post('refresh')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 20 } })
  async refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refreshTokens(dto.refreshToken);
  }

  /**
   * POST /auth/logout
   * Invalidates the refresh token — user must login again after this.
   */
  @Post('logout')
  @Public()
  @HttpCode(HttpStatus.OK)
  async logout(@Body() dto: RefreshTokenDto) {
    await this.authService.logout(dto.refreshToken);
    return { message: 'Logged out successfully' };
  }
}
