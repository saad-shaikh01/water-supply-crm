import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { AuthUser } from '@water-supply-crm/types';
import { RequireSuperAdmin } from '../../common/decorators/authz-markers.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuditService } from '../audit/audit.service';
import { AuthSessionService } from './session/auth-session.service';
import { TwoFactorService } from './two-factor/two-factor.service';
import { DisableTwoFactorDto, TotpCodeDto } from './dto/two-factor.dto';

/** Self-service security for the signed-in platform administrator (2FA + sessions). */
@Controller('admin/security')
@RequireSuperAdmin()
export class SecurityController {
  constructor(
    private readonly twoFactor: TwoFactorService,
    private readonly sessions: AuthSessionService,
    private readonly audit: AuditService,
  ) {}

  private log(user: AuthUser, action: string, entity: string, entityId: string, after?: unknown) {
    void this.audit.log({
      userId: user.userId,
      userName: user.name,
      action,
      entity,
      entityId,
      changes: { after },
    });
  }

  @Get('2fa')
  status(@CurrentUser() user: AuthUser) {
    return this.twoFactor.getStatus(user.userId);
  }

  @Post('2fa/setup')
  @HttpCode(HttpStatus.OK)
  @Throttle({ short: { ttl: 1000, limit: 2 }, medium: { ttl: 60000, limit: 10 } })
  setup(@CurrentUser() user: AuthUser) {
    return this.twoFactor.setup(user.userId, user.email);
  }

  @Post('2fa/confirm')
  @HttpCode(HttpStatus.OK)
  @Throttle({ short: { ttl: 1000, limit: 2 }, medium: { ttl: 60000, limit: 10 } })
  async confirm(@CurrentUser() user: AuthUser, @Body() dto: TotpCodeDto) {
    const res = await this.twoFactor.confirm(user.userId, dto.code);
    // Everything else signed in as this admin predates 2FA: drop it, keep the current session.
    await this.sessions.revokeAll(user.userId, {
      reason: 'USER_REVOKE',
      revokedById: user.userId,
      exceptSessionId: user.sessionId,
    });
    this.log(user, 'ENABLE_2FA', 'TwoFactor', user.userId);
    return res;
  }

  @Post('2fa/recovery-codes/regenerate')
  @HttpCode(HttpStatus.OK)
  @Throttle({ short: { ttl: 1000, limit: 2 }, medium: { ttl: 60000, limit: 5 } })
  async regenerate(@CurrentUser() user: AuthUser, @Body() dto: TotpCodeDto) {
    const res = await this.twoFactor.regenerateRecoveryCodes(user.userId, dto.code);
    this.log(user, 'REGENERATE_RECOVERY_CODES', 'TwoFactor', user.userId);
    return res;
  }

  @Post('2fa/disable')
  @HttpCode(HttpStatus.OK)
  @Throttle({ short: { ttl: 1000, limit: 2 }, medium: { ttl: 60000, limit: 5 } })
  async disable(@CurrentUser() user: AuthUser, @Body() dto: DisableTwoFactorDto) {
    await this.twoFactor.disable(user.userId, dto.password, dto.code);
    this.log(user, 'DISABLE_2FA', 'TwoFactor', user.userId);
    return { message: 'Two-factor authentication disabled' };
  }

  @Get('sessions')
  listSessions(@CurrentUser() user: AuthUser) {
    return this.sessions.list(user.userId, user.sessionId);
  }

  @Post('sessions/revoke-others')
  @HttpCode(HttpStatus.OK)
  async revokeOthers(@CurrentUser() user: AuthUser) {
    const revoked = await this.sessions.revokeAll(user.userId, {
      reason: 'USER_REVOKE',
      revokedById: user.userId,
      exceptSessionId: user.sessionId,
    });
    this.log(user, 'REVOKE_SESSIONS', 'AuthSession', user.userId, { revoked });
    return { revoked };
  }

  @Delete('sessions/:id')
  @HttpCode(HttpStatus.OK)
  async revokeSession(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.sessions.revoke(id, user.userId, { reason: 'USER_REVOKE', revokedById: user.userId });
    this.log(user, 'REVOKE_SESSION', 'AuthSession', id);
    return { message: 'Session revoked' };
  }
}
