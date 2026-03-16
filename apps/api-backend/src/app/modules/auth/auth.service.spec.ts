import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { CacheInvalidationService } from '@water-supply-crm/caching';
import { AuthService } from './auth.service';
import { EmailService } from '../email/email.service';
import { UserService } from '../user/user.service';
import { createMockUser } from '../../../test';

jest.mock('bcrypt');
jest.mock('crypto', () => ({
  ...jest.requireActual('crypto'),
  randomUUID: jest.fn(),
}));

describe('AuthService', () => {
  let moduleRef: TestingModule;
  let service: AuthService;
  let jwtService: { sign: jest.Mock; verify: jest.Mock };
  let cache: {
    get: jest.Mock;
    set: jest.Mock;
    del: jest.Mock;
  };
  let userService: {
    findByIdentifier: jest.Mock;
    findByEmail: jest.Mock;
    findById: jest.Mock;
    updatePassword: jest.Mock;
  };
  let emailService: {
    sendPasswordReset: jest.Mock;
    sendPasswordChanged: jest.Mock;
  };

  beforeEach(async () => {
    jwtService = {
      sign: jest.fn().mockReturnValue('signed-access-token'),
      verify: jest.fn(),
    };
    cache = {
      get: jest.fn(),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
    };
    userService = {
      findByIdentifier: jest.fn(),
      findByEmail: jest.fn(),
      findById: jest.fn(),
      updatePassword: jest.fn().mockResolvedValue(undefined),
    };
    emailService = {
      sendPasswordReset: jest.fn().mockResolvedValue(undefined),
      sendPasswordChanged: jest.fn().mockResolvedValue(undefined),
    };

    moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UserService, useValue: userService },
        { provide: JwtService, useValue: jwtService },
        { provide: EmailService, useValue: emailService },
        { provide: CacheInvalidationService, useValue: cache },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('validateUser', () => {
    it('returns the user without password when credentials are valid', async () => {
      const user = createMockUser({
        email: 'driver@test.com',
        password: '$2b$10$hashed',
      });
      userService.findByIdentifier.mockResolvedValue(user);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.validateUser('driver@test.com', 'correct-pass');

      expect(userService.findByIdentifier).toHaveBeenCalledWith(
        'driver@test.com',
      );
      expect(bcrypt.compare).toHaveBeenCalledWith('correct-pass', '$2b$10$hashed');
      expect(result).toEqual(
        expect.objectContaining({
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          vendorId: user.vendorId,
        }),
      );
      expect(result).not.toHaveProperty('password');
    });

    it('returns null when no user matches the identifier', async () => {
      userService.findByIdentifier.mockResolvedValue(null);

      await expect(service.validateUser('missing@test.com', 'pass')).resolves.toBeNull();
    });

    it('returns null when the password comparison fails', async () => {
      userService.findByIdentifier.mockResolvedValue(createMockUser());
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.validateUser('driver@test.com', 'wrong-pass'),
      ).resolves.toBeNull();
    });
  });

  describe('login', () => {
    it('returns the current token response shape and stores the refresh token in cache', async () => {
      (crypto.randomUUID as jest.Mock).mockReturnValue(
        '11111111-1111-1111-1111-111111111111',
      );
      const user = createMockUser({
        email: 'driver@test.com',
        name: 'Driver One',
      });

      const result = await service.login(user);

      expect(jwtService.sign).toHaveBeenCalledWith({
        sub: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        vendorId: user.vendorId,
      });
      expect(cache.set).toHaveBeenCalledWith(
        'auth:refresh:11111111-1111-1111-1111-111111111111',
        { userId: user.id },
        604800000,
      );
      expect(result).toEqual({
        access_token: 'signed-access-token',
        refresh_token: '11111111-1111-1111-1111-111111111111',
        expires_in: 86400,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          vendorId: user.vendorId,
        },
      });
    });

    it('includes customerId in both the JWT payload and response user for customer logins', async () => {
      (crypto.randomUUID as jest.Mock).mockReturnValue(
        '22222222-2222-2222-2222-222222222222',
      );
      const customerUser = {
        ...createMockUser({
          id: 'user-customer-1',
          email: 'customer@test.com',
          role: 'CUSTOMER',
        }),
        customer: { id: 'customer-1' },
      };

      const result = await service.login(customerUser);

      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          customerId: 'customer-1',
        }),
      );
      expect(result.user).toEqual(
        expect.objectContaining({
          customerId: 'customer-1',
        }),
      );
    });
  });

  describe('refreshTokens', () => {
    it('rotates a valid refresh token and returns a new token pair', async () => {
      (crypto.randomUUID as jest.Mock).mockReturnValue(
        '33333333-3333-3333-3333-333333333333',
      );
      cache.get.mockResolvedValue({ userId: 'user-test-001' });
      userService.findById.mockResolvedValue(createMockUser());

      const result = await service.refreshTokens('refresh-token-old');

      expect(cache.get).toHaveBeenCalledWith('auth:refresh:refresh-token-old');
      expect(cache.del).toHaveBeenCalledWith('auth:refresh:refresh-token-old');
      expect(cache.set).toHaveBeenCalledWith(
        'auth:refresh:33333333-3333-3333-3333-333333333333',
        { userId: 'user-test-001' },
        604800000,
      );
      expect(result.refresh_token).toBe('33333333-3333-3333-3333-333333333333');
    });

    it('throws when the refresh token is missing from cache', async () => {
      cache.get.mockResolvedValue(null);

      await expect(service.refreshTokens('missing-token')).rejects.toThrow(
        new UnauthorizedException('Invalid or expired refresh token'),
      );
    });

    it('throws when the cached user no longer exists', async () => {
      cache.get.mockResolvedValue({ userId: 'missing-user' });
      userService.findById.mockResolvedValue(null);

      await expect(service.refreshTokens('stale-token')).rejects.toThrow(
        new UnauthorizedException('User not found or deactivated'),
      );
      expect(cache.del).toHaveBeenCalledWith('auth:refresh:stale-token');
    });

    it('throws when the cached user has been deactivated', async () => {
      cache.get.mockResolvedValue({ userId: 'user-test-001' });
      userService.findById.mockResolvedValue(
        createMockUser({ isActive: false }),
      );

      await expect(service.refreshTokens('deactivated-token')).rejects.toThrow(
        new UnauthorizedException('User not found or deactivated'),
      );
    });
  });

  describe('logout', () => {
    it('deletes the current refresh token key', async () => {
      await service.logout('refresh-token-1');

      expect(cache.del).toHaveBeenCalledWith('auth:refresh:refresh-token-1');
    });
  });

  describe('generateResetToken', () => {
    it('signs a password reset token and emails it when the user exists', async () => {
      const user = createMockUser({
        email: 'user@test.com',
        name: 'Reset User',
      });
      userService.findByEmail.mockResolvedValue(user);
      jwtService.sign.mockReturnValue('reset-jwt-token');

      await service.generateResetToken('user@test.com');

      expect(jwtService.sign).toHaveBeenCalledWith(
        {
          sub: user.id,
          email: user.email,
          type: 'password-reset',
        },
        { expiresIn: '15m' },
      );
      expect(emailService.sendPasswordReset).toHaveBeenCalledWith(
        user.email,
        user.name,
        'reset-jwt-token',
      );
    });

    it('returns silently when the email is unknown', async () => {
      userService.findByEmail.mockResolvedValue(null);

      await expect(
        service.generateResetToken('missing@test.com'),
      ).resolves.toBeUndefined();
      expect(emailService.sendPasswordReset).not.toHaveBeenCalled();
    });
  });

  describe('verifyResetToken', () => {
    it('returns the user id when the token is a password-reset JWT', async () => {
      jwtService.verify.mockReturnValue({
        sub: 'user-test-001',
        type: 'password-reset',
      });

      await expect(service.verifyResetToken('valid-reset-token')).resolves.toEqual(
        { userId: 'user-test-001' },
      );
    });

    it('throws when the token type is not password-reset', async () => {
      jwtService.verify.mockReturnValue({
        sub: 'user-test-001',
        type: 'access',
      });

      await expect(service.verifyResetToken('wrong-type')).rejects.toThrow(
        new UnauthorizedException('Invalid or expired reset token'),
      );
    });
  });

  describe('resetPassword', () => {
    it('hashes, saves, and confirms the password change for a valid reset token', async () => {
      jwtService.verify.mockReturnValue({
        sub: 'user-test-001',
        type: 'password-reset',
      });
      userService.findById.mockResolvedValue(
        createMockUser({
          id: 'user-test-001',
          email: 'driver@test.com',
          name: 'Driver One',
        }),
      );
      (bcrypt.hash as jest.Mock).mockResolvedValue('$2b$10$new-hash');

      await service.resetPassword('valid-reset-token', 'new-password');

      expect(bcrypt.hash).toHaveBeenCalledWith('new-password', 10);
      expect(userService.updatePassword).toHaveBeenCalledWith(
        'user-test-001',
        '$2b$10$new-hash',
      );
      expect(emailService.sendPasswordChanged).toHaveBeenCalledWith(
        'driver@test.com',
        'Driver One',
      );
    });

    it('throws UnauthorizedException when the reset token is invalid', async () => {
      jwtService.verify.mockImplementation(() => {
        throw new Error('jwt malformed');
      });

      await expect(
        service.resetPassword('bad-token', 'new-password'),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('getProfile', () => {
    it('returns the user without password when found', async () => {
      const user = createMockUser({
        password: '$2b$10$hashed',
        email: 'profile@test.com',
      });
      userService.findById.mockResolvedValue(user);

      const result = await service.getProfile(user.id);

      expect(result).toEqual(
        expect.objectContaining({
          id: user.id,
          email: 'profile@test.com',
        }),
      );
      expect(result).not.toHaveProperty('password');
    });
  });
});
