import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { CacheInvalidationService } from '@water-supply-crm/caching';
import { CustomerActivationService } from './customer-activation.service';
import { UserService } from '../user/user.service';
import { AuthService } from '../auth/auth.service';
import { AuditService } from '../audit/audit.service';

/**
 * Unit tests: CustomerActivationService — self-service portal activation via
 * Customer Code + registered phone (docs: customer-portal self-activation).
 * Mirrors CollectionPolicyService's mocking convention (no dedicated spec
 * existed for this module to follow).
 */
describe('CustomerActivationService', () => {
  let service: CustomerActivationService;
  let mockPrisma: any;
  let mockCache: any;
  let mockUserService: any;
  let mockAuthService: any;
  let mockAudit: any;

  const CUSTOMER = {
    id: 'cust-1',
    vendorId: 'vendor-1',
    customerCode: 'L0001',
    name: 'Ahmed Khan',
    phoneNumber: '0300-1234567',
    isActive: true,
    userId: null as string | null,
  };

  beforeEach(async () => {
    mockPrisma = {
      customer: { findUnique: jest.fn(), update: jest.fn() },
      user: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
      $transaction: jest.fn(async (cb: any) => cb(mockPrisma)),
    };
    mockCache = {
      get: jest.fn(),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
    };
    mockUserService = { findById: jest.fn() };
    mockAuthService = { login: jest.fn() };
    mockAudit = { log: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomerActivationService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: CacheInvalidationService, useValue: mockCache },
        { provide: UserService, useValue: mockUserService },
        { provide: AuthService, useValue: mockAuthService },
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile();

    service = module.get<CustomerActivationService>(CustomerActivationService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('checkEligibility', () => {
    it('returns eligible for a never-activated, active customer with matching phone', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue({ ...CUSTOMER });

      const result = await service.checkEligibility({
        customerCode: 'L0001',
        phoneNumber: '03001234567',
      });

      expect(result).toEqual({
        eligible: true,
        alreadyActivated: false,
        customerName: 'Ahmed Khan',
      });
    });

    it('returns alreadyActivated=true when the customer already has a portal account', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue({ ...CUSTOMER, userId: 'user-1' });

      const result = await service.checkEligibility({
        customerCode: 'L0001',
        phoneNumber: '03001234567',
      });

      expect(result.eligible).toBe(true);
      expect(result.alreadyActivated).toBe(true);
    });

    it('rejects an unknown customer code', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue(null);

      const result = await service.checkEligibility({
        customerCode: 'L9999',
        phoneNumber: '03001234567',
      });

      expect(result.eligible).toBe(false);
      expect(result.reason).toMatch(/not found/i);
    });

    it('rejects a phone number that does not match records', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue({ ...CUSTOMER });

      const result = await service.checkEligibility({
        customerCode: 'L0001',
        phoneNumber: '03009999999',
      });

      expect(result.eligible).toBe(false);
      expect(result.reason).toMatch(/phone/i);
    });

    it('rejects an inactive customer', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue({ ...CUSTOMER, isActive: false });

      const result = await service.checkEligibility({
        customerCode: 'L0001',
        phoneNumber: '03001234567',
      });

      expect(result.eligible).toBe(false);
      expect(result.reason).toMatch(/inactive/i);
    });

    it('locks out after repeated failed attempts for the same customer code', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue(null);
      mockCache.get.mockImplementation((key: string) =>
        key.startsWith('activation:fail:') ? 4 : undefined,
      );

      await service.checkEligibility({ customerCode: 'L0001', phoneNumber: '03001234567' });

      expect(mockCache.set).toHaveBeenCalledWith(
        expect.stringContaining('activation:lock:'),
        true,
        expect.any(Number),
      );
    });

    it('throws when the customer code is already locked out', async () => {
      mockCache.get.mockImplementation((key: string) =>
        key.startsWith('activation:lock:') ? true : undefined,
      );

      await expect(
        service.checkEligibility({ customerCode: 'L0001', phoneNumber: '03001234567' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('activate', () => {
    it('creates a new User and logs the customer in on first activation', async () => {
      mockPrisma.customer.findUnique
        .mockResolvedValueOnce({ ...CUSTOMER }) // verifyCustomer lookup
        .mockResolvedValueOnce({ ...CUSTOMER }); // re-check inside transaction
      mockPrisma.user.findUnique.mockResolvedValue(null); // no phone collision
      mockPrisma.user.create.mockResolvedValue({ id: 'user-1' });
      mockUserService.findById.mockResolvedValue({ id: 'user-1', role: 'CUSTOMER', customer: { id: 'cust-1' } });
      mockAuthService.login.mockResolvedValue({ access_token: 'a', refresh_token: 'r', expires_in: 86400 });

      const result = await service.activate({
        customerCode: 'L0001',
        phoneNumber: '03001234567',
        password: 'Password1',
      });

      expect(mockPrisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ phoneNumber: '923001234567', role: 'CUSTOMER' }),
        }),
      );
      expect(mockPrisma.customer.update).toHaveBeenCalledWith({
        where: { id: 'cust-1' },
        data: { userId: 'user-1' },
      });
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ACTIVATE', entity: 'Customer', entityId: 'cust-1' }),
      );
      expect(mockAuthService.login).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'user-1' }),
      );
      expect(result).toEqual({ access_token: 'a', refresh_token: 'r', expires_in: 86400 });
    });

    it('rejects activate() when the customer is already activated (use resetPassword instead)', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue({ ...CUSTOMER, userId: 'user-1' });

      await expect(
        service.activate({ customerCode: 'L0001', phoneNumber: '03001234567', password: 'Password1' }),
      ).rejects.toThrow(ConflictException);
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('rejects activation when the customer/phone verification fails', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue(null);

      await expect(
        service.activate({ customerCode: 'L9999', phoneNumber: '03001234567', password: 'Password1' }),
      ).rejects.toThrow(UnauthorizedException);
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
    });

    it('rejects a duplicate/concurrent activation race (second caller sees userId already set)', async () => {
      mockPrisma.customer.findUnique
        .mockResolvedValueOnce({ ...CUSTOMER }) // verifyCustomer sees unactivated
        .mockResolvedValueOnce({ ...CUSTOMER, userId: 'user-1' }); // transaction re-check sees it was just activated

      await expect(
        service.activate({ customerCode: 'L0001', phoneNumber: '03001234567', password: 'Password1' }),
      ).rejects.toThrow(ConflictException);
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
    });

    it('rejects when the normalized phone is already linked to another portal account', async () => {
      mockPrisma.customer.findUnique
        .mockResolvedValueOnce({ ...CUSTOMER })
        .mockResolvedValueOnce({ ...CUSTOMER });
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'other-user' });

      await expect(
        service.activate({ customerCode: 'L0001', phoneNumber: '03001234567', password: 'Password1' }),
      ).rejects.toThrow(ConflictException);
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
    });
  });

  describe('resetPassword', () => {
    it('updates the password of an already-activated customer and logs them in', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue({ ...CUSTOMER, userId: 'user-1' });
      mockUserService.findById.mockResolvedValue({ id: 'user-1', role: 'CUSTOMER', customer: { id: 'cust-1' } });
      mockAuthService.login.mockResolvedValue({ access_token: 'a', refresh_token: 'r', expires_in: 86400 });

      const result = await service.resetPassword({
        customerCode: 'L0001',
        phoneNumber: '03001234567',
        password: 'NewPassword1',
      });

      expect(mockPrisma.user.create).not.toHaveBeenCalled();
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { password: expect.any(String) },
      });
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'RESET_PASSWORD_SELF_SERVICE', entityId: 'cust-1' }),
      );
      expect(mockAuthService.login).toHaveBeenCalledWith(expect.objectContaining({ id: 'user-1' }));
      expect(result).toEqual({ access_token: 'a', refresh_token: 'r', expires_in: 86400 });
    });

    it('rejects resetPassword() when the customer has never been activated (use activate instead)', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue({ ...CUSTOMER });

      await expect(
        service.resetPassword({ customerCode: 'L0001', phoneNumber: '03001234567', password: 'Password1' }),
      ).rejects.toThrow(ConflictException);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('rejects resetPassword() when the customer/phone verification fails', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue(null);

      await expect(
        service.resetPassword({ customerCode: 'L9999', phoneNumber: '03001234567', password: 'Password1' }),
      ).rejects.toThrow(UnauthorizedException);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });
  });
});
