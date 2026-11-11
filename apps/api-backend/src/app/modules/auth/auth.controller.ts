import {
  Controller,
  Post,
  Get,
  Body,
  UnauthorizedException,
  HttpCode,
  HttpStatus,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { EnrollmentConfirmDto, EnrollmentTokenDto, VerifyTwoFactorDto } from './dto/two-factor.dto';

/** Client IP / UA for lockout counters and session listing (req.ip honours trust proxy). */
const ctxOf = (req: any) => ({
  ip: req?.ip as string | undefined,
  userAgent: req?.headers?.['user-agent'] as string | undefined,
});
import { Public } from '../../common/decorators/public.decorator';
import { AllowCustomer, AuthenticatedOnly } from '../../common/decorators/authz-markers.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '@water-supply-crm/types';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { PermissionService } from '../authz/permission.service';

@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private permissionService: PermissionService,
    private platformSettings: PlatformSettingsService,
  ) {}

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({
    short: { ttl: 1000, limit: 3 },
    medium: { ttl: 60000, limit: 5 },
    long: { ttl: 3600000, limit: 20 },
  })
  async login(@Body() loginDto: LoginDto, @Req() req: any) {
    const user = await this.authService.validateUser(
      loginDto.identifier,
      loginDto.password,
      ctxOf(req),
    );
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }
    // Maintenance: credentials were verified; only platform admins may proceed (others see the notice).
    if (user.role !== 'SUPER_ADMIN') await this.platformSettings.assertNotInMaintenance();
    return this.authService.login(user, ctxOf(req));
  }

  /** POST /auth/2fa/verify: second step of a SUPER_ADMIN login (challengeToken from /auth/login). */
  @Post('2fa/verify')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 5 }, long: { ttl: 3600000, limit: 20 } })
  verifyTwoFactor(@Body() dto: VerifyTwoFactorDto, @Req() req: any) {
    return this.authService.verifyTwoFactorLogin(dto, ctxOf(req));
  }

  /** POST /auth/2fa/enroll/start: forced enrollment at login (enrollmentToken from /auth/login). */
  @Post('2fa/enroll/start')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 10 } })
  enrollStart(@Body() dto: EnrollmentTokenDto) {
    return this.authService.startTwoFactorEnrollment(dto.enrollmentToken);
  }

  @Post('2fa/enroll/confirm')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 5 }, long: { ttl: 3600000, limit: 20 } })
  enrollConfirm(@Body() dto: EnrollmentConfirmDto, @Req() req: any) {
    return this.authService.confirmTwoFactorEnrollment(dto.enrollmentToken, dto.code, ctxOf(req));
  }

  @Get('me')
  @AuthenticatedOnly()
  @AllowCustomer()
  async getProfile(@CurrentUser() user: AuthUser) {
    const [profile, permissions] = await Promise.all([
      this.authService.getProfile(user.userId),
      this.permissionService.getEffectivePermissions(user.userId),
    ]);
    return {
      ...profile,
      ...(user.impersonation && { impersonation: user.impersonation }),
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
  async refresh(@Body() dto: RefreshTokenDto, @Req() req: any) {
    return this.authService.refreshTokens(dto.refreshToken, ctxOf(req));
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
