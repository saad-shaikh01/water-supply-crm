import {
  Injectable,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { UserService } from '../user/user.service';
import { EmailService } from '../email/email.service';
import { CacheInvalidationService } from '@water-supply-crm/caching';
import * as bcrypt from 'bcrypt';

const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds
const REFRESH_KEY = (token: string) => `auth:refresh:${token}`;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private userService: UserService,
    private jwtService: JwtService,
    private emailService: EmailService,
    private cache: CacheInvalidationService,
  ) {}

  async validateUser(email: string, pass: string): Promise<any> {
    const user = await this.userService.findByEmail(email);
    if (user && (await bcrypt.compare(pass, user.password))) {
      const { password, ...result } = user;
      return result;
    }
    return null;
  }

  async login(user: any) {
    return this.generateTokens(user);
  }

  async refreshTokens(refreshToken: string) {
    // Validate refresh token against Redis
    const stored = await this.cache.get<any>(REFRESH_KEY(refreshToken));
    if (!stored) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // Rotate: delete old token, issue new pair
    await this.cache.del(REFRESH_KEY(refreshToken));
    const user = await this.userService.findById(stored.userId);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('User not found or deactivated');
    }

    return this.generateTokens(user);
  }

  async logout(refreshToken: string): Promise<void> {
    await this.cache.del(REFRESH_KEY(refreshToken));
  }

  private async generateTokens(user: any) {
    const payload: any = {
      sub: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      vendorId: user.vendorId,
    };

    if (user.role === 'CUSTOMER' && user.customer?.id) {
      payload.customerId = user.customer.id;
    }

    const access_token = this.jwtService.sign(payload);

    // Generate opaque refresh token and store in Redis (7 days)
    const refreshToken = randomUUID();
    await this.cache.set(
      REFRESH_KEY(refreshToken),
      { userId: user.id },
      REFRESH_TTL_MS,
    );

    return {
      access_token,
      refresh_token: refreshToken,
      expires_in: 86400, // 1 day in seconds (matches JWT expiry in auth.module.ts)
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        vendorId: user.vendorId,
        ...(payload.customerId && { customerId: payload.customerId }),
      },
    };
  }

  async getProfile(userId: string) {
    const user = await this.userService.findById(userId);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    const { password, ...result } = user;
    return result;
  }

  async generateResetToken(email: string): Promise<void> {
    const user = await this.userService.findByEmail(email);
    if (!user) {
      // Don't reveal whether the email exists — always return silently
      this.logger.log(`Password reset requested for unknown email: ${email}`);
      return;
    }

    const token = this.jwtService.sign(
      { sub: user.id, email: user.email, type: 'password-reset' },
      { expiresIn: '15m' },
    );

    // Send the reset email (non-blocking — failure doesn't crash the request)
    await this.emailService.sendPasswordReset(user.email, user.name ?? 'User', token);
  }

  async verifyResetToken(token: string): Promise<{ userId: string }> {
    try {
      const payload = this.jwtService.verify(token);
      if (payload.type !== 'password-reset') {
        throw new UnauthorizedException('Invalid reset token');
      }
      return { userId: payload.sub };
    } catch {
      throw new UnauthorizedException('Invalid or expired reset token');
    }
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const { userId } = await this.verifyResetToken(token);
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await this.userService.updatePassword(userId, hashedPassword);

    // Send confirmation email (non-blocking)
    const user = await this.userService.findById(userId);
    if (user) {
      await this.emailService.sendPasswordChanged(user.email, user.name ?? 'User');
    }
  }
}
