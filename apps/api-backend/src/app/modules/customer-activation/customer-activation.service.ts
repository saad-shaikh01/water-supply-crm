import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '@water-supply-crm/database';
import { CacheInvalidationService } from '@water-supply-crm/caching';
import { UserService } from '../user/user.service';
import { AuthService } from '../auth/auth.service';
import { AuditService } from '../audit/audit.service';
import { normalizePhone } from '../whatsapp/phone.util';
import { CheckEligibilityDto } from './dto/check-eligibility.dto';
import { ActivateDto } from './dto/activate.dto';

const LOCK_KEY = (code: string) => `activation:lock:${code}`;
const FAIL_KEY = (code: string) => `activation:fail:${code}`;
const MAX_ATTEMPTS = 5;
const LOCK_MS = 15 * 60 * 1000;

interface EligibilityResult {
  eligible: boolean;
  reason?: string;
  alreadyActivated?: boolean;
  customerName?: string;
}

/**
 * Self-service activation: proves customer identity via Customer Code + registered
 * phone number (both already held by the customer — no admin, no email, no invite).
 * The same proof is reused for password reset on an already-activated account, since
 * self-activated accounts have no email and can't use the /auth/forgot-password flow.
 */
@Injectable()
export class CustomerActivationService {
  constructor(
    private prisma: PrismaService,
    private cache: CacheInvalidationService,
    private userService: UserService,
    private authService: AuthService,
    private audit: AuditService,
  ) {}

  private async verifyCustomer(
    customerCode: string,
    phoneNumber: string,
  ): Promise<{ customer: { id: string; vendorId: string; name: string; phoneNumber: string; isActive: boolean; userId: string | null } | null; result: EligibilityResult }> {
    const code = customerCode.trim();
    const lockKey = LOCK_KEY(code);
    const failKey = FAIL_KEY(code);

    const isLocked = await this.cache.get(lockKey);
    if (isLocked) {
      throw new UnauthorizedException(
        'Too many failed attempts. Try again in 15 minutes.',
      );
    }

    const fail = async (reason: string) => {
      const fails = ((await this.cache.get<number>(failKey)) ?? 0) + 1;
      if (fails >= MAX_ATTEMPTS) {
        await this.cache.set(lockKey, true, LOCK_MS);
        await this.cache.del(failKey);
      } else {
        await this.cache.set(failKey, fails, LOCK_MS);
      }
      return { customer: null, result: { eligible: false, reason } };
    };

    const customer = await this.prisma.customer.findUnique({ where: { customerCode: code } });
    if (!customer) {
      return fail('Customer not found. Check the customer code and try again.');
    }

    const normalizedInput = normalizePhone(phoneNumber);
    const normalizedStored = normalizePhone(customer.phoneNumber);
    if (!normalizedInput || normalizedInput !== normalizedStored) {
      return fail('Phone number does not match our records.');
    }

    if (!customer.isActive) {
      return fail('This account is inactive. Contact your vendor.');
    }

    await this.cache.del(failKey);

    return {
      customer,
      result: {
        eligible: true,
        alreadyActivated: !!customer.userId,
        customerName: customer.name,
      },
    };
  }

  async checkEligibility(dto: CheckEligibilityDto): Promise<EligibilityResult> {
    const { result } = await this.verifyCustomer(dto.customerCode, dto.phoneNumber);
    return result;
  }

  /** First-time activation only — creates the User. Rejects an already-activated customer. */
  async activate(dto: ActivateDto) {
    const { customer, result } = await this.verifyCustomer(dto.customerCode, dto.phoneNumber);
    if (!result.eligible || !customer) {
      throw new UnauthorizedException(result.reason ?? 'Unable to verify customer.');
    }
    if (customer.userId) {
      throw new ConflictException(
        'This account is already activated. Use "Reset Password" instead.',
      );
    }

    const normalizedPhone = normalizePhone(dto.phoneNumber);
    const hashedPassword = await bcrypt.hash(dto.password, 10);

    const userId = await this.prisma.$transaction(async (tx) => {
      const fresh = await tx.customer.findUnique({ where: { id: customer.id } });
      if (fresh?.userId) {
        throw new ConflictException('This account was just activated. Please log in.');
      }

      const existingPhone = await tx.user.findUnique({ where: { phoneNumber: normalizedPhone } });
      if (existingPhone) {
        throw new ConflictException(
          'This phone number is already linked to another portal account. Contact your vendor.',
        );
      }

      const user = await tx.user.create({
        data: {
          phoneNumber: normalizedPhone,
          password: hashedPassword,
          name: customer.name,
          role: 'CUSTOMER',
        },
      });

      await tx.customer.update({ where: { id: customer.id }, data: { userId: user.id } });

      return user.id;
    });

    await this.audit.log({
      vendorId: customer.vendorId,
      action: 'ACTIVATE',
      entity: 'Customer',
      entityId: customer.id,
    });

    return this.loginAs(userId);
  }

  /** Self-service password reset only — requires the customer to already be activated. */
  async resetPassword(dto: ActivateDto) {
    const { customer, result } = await this.verifyCustomer(dto.customerCode, dto.phoneNumber);
    if (!result.eligible || !customer) {
      throw new UnauthorizedException(result.reason ?? 'Unable to verify customer.');
    }
    if (!customer.userId) {
      throw new ConflictException(
        'This account has not been activated yet. Use "Activate Account" instead.',
      );
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);
    await this.prisma.user.update({
      where: { id: customer.userId },
      data: { password: hashedPassword },
    });

    await this.audit.log({
      vendorId: customer.vendorId,
      action: 'RESET_PASSWORD_SELF_SERVICE',
      entity: 'Customer',
      entityId: customer.id,
    });

    return this.loginAs(customer.userId);
  }

  private async loginAs(userId: string) {
    const user = await this.userService.findById(userId);
    if (!user) {
      throw new UnauthorizedException('Something went wrong. Please try again.');
    }
    return this.authService.login(user);
  }
}
