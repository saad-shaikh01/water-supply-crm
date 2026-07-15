import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { CacheInvalidationService } from '@water-supply-crm/caching';
import { CollectionPolicyService } from './collection-policy.service';
import { AuditService } from '../audit/audit.service';
import { UpdateCollectionPolicyDto } from './dto/update-collection-policy.dto';
import { UpdateCashCollectionPolicyDto } from './dto/update-cash-collection-policy.dto';

/**
 * Unit tests: CollectionPolicyService — caching strategy (§8) and
 * enable/disable transitions (Phase 4 QA scope,
 * docs/features/monthly-customer-collection-policy.md).
 *
 * Mirrors NotificationSettingsService's pattern exactly (no dedicated spec
 * exists for that service to follow, so this establishes the convention for
 * this module): cache hit -> no DB call; cache miss -> DB read + populate
 * cache; write -> upsert + explicit cache invalidation + audit log.
 */
describe('CollectionPolicyService', () => {
  let service: CollectionPolicyService;
  let mockPrisma: any;
  let mockCache: any;
  let mockAudit: any;

  const VENDOR_ID = 'vendor-001';

  const DEFAULT_POLICY = {
    enabled: false,
    minOutstandingThreshold: 1000,
    minCollectionPercentage: 90,
    allowedShortfall: 300,
  };

  beforeEach(async () => {
    mockPrisma = {
      collectionPolicyConfig: { findUnique: jest.fn(), upsert: jest.fn() },
      cashCollectionPolicyConfig: { findUnique: jest.fn(), upsert: jest.fn() },
    };
    mockCache = {
      get: jest.fn(),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
    };
    mockAudit = { log: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CollectionPolicyService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: CacheInvalidationService, useValue: mockCache },
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile();

    service = module.get<CollectionPolicyService>(CollectionPolicyService);
  });

  afterEach(() => jest.clearAllMocks());

  // ── getPolicy: caching ─────────────────────────────────────────────────

  it('returns the cached policy without hitting the database on a cache hit', async () => {
    const cached = { ...DEFAULT_POLICY, enabled: true };
    mockCache.get.mockResolvedValue(cached);

    const result = await service.getPolicy(VENDOR_ID);

    expect(result).toEqual(cached);
    expect(mockPrisma.collectionPolicyConfig.findUnique).not.toHaveBeenCalled();
  });

  it('returns the default (disabled) policy and caches it when no row exists', async () => {
    mockCache.get.mockResolvedValue(undefined);
    mockPrisma.collectionPolicyConfig.findUnique.mockResolvedValue(null);

    const result = await service.getPolicy(VENDOR_ID);

    expect(result).toEqual(DEFAULT_POLICY);
    expect(mockCache.set).toHaveBeenCalledWith(
      `vendor:${VENDOR_ID}:collection-policy`,
      DEFAULT_POLICY,
      5 * 60 * 1000,
    );
  });

  it('returns the persisted row values and caches them when a row exists', async () => {
    mockCache.get.mockResolvedValue(undefined);
    const row = {
      id: 'row-1',
      vendorId: VENDOR_ID,
      enabled: true,
      minOutstandingThreshold: 500,
      minCollectionPercentage: 80,
      allowedShortfall: 100,
    };
    mockPrisma.collectionPolicyConfig.findUnique.mockResolvedValue(row);

    const result = await service.getPolicy(VENDOR_ID);

    expect(result).toEqual({
      enabled: true,
      minOutstandingThreshold: 500,
      minCollectionPercentage: 80,
      allowedShortfall: 100,
    });
    expect(mockCache.set).toHaveBeenCalledWith(
      `vendor:${VENDOR_ID}:collection-policy`,
      result,
      5 * 60 * 1000,
    );
  });

  it('scopes the cache key per vendor', async () => {
    mockCache.get.mockResolvedValue(undefined);
    mockPrisma.collectionPolicyConfig.findUnique.mockResolvedValue(null);

    await service.getPolicy('vendor-A');
    await service.getPolicy('vendor-B');

    expect(mockCache.get).toHaveBeenCalledWith('vendor:vendor-A:collection-policy');
    expect(mockCache.get).toHaveBeenCalledWith('vendor:vendor-B:collection-policy');
  });

  // ── updatePolicy: enable/disable transitions + cache invalidation ───────

  const UPDATE_DTO: UpdateCollectionPolicyDto = {
    enabled: true,
    minOutstandingThreshold: 1000,
    minCollectionPercentage: 90,
    allowedShortfall: 300,
  };

  it('upserts the config keyed by vendorId', async () => {
    mockPrisma.collectionPolicyConfig.upsert.mockResolvedValue({ id: 'row-1', vendorId: VENDOR_ID, ...UPDATE_DTO });

    await service.updatePolicy(VENDOR_ID, UPDATE_DTO);

    expect(mockPrisma.collectionPolicyConfig.upsert).toHaveBeenCalledWith({
      where: { vendorId: VENDOR_ID },
      create: { vendorId: VENDOR_ID, ...UPDATE_DTO },
      update: { ...UPDATE_DTO },
    });
  });

  it('invalidates the cache on every write (explicit del, not just TTL)', async () => {
    mockPrisma.collectionPolicyConfig.upsert.mockResolvedValue({ id: 'row-1', vendorId: VENDOR_ID, ...UPDATE_DTO });

    await service.updatePolicy(VENDOR_ID, UPDATE_DTO);

    expect(mockCache.del).toHaveBeenCalledWith(`vendor:${VENDOR_ID}:collection-policy`);
  });

  it('writes an UPDATE_COLLECTION_POLICY audit entry on every write', async () => {
    mockPrisma.collectionPolicyConfig.upsert.mockResolvedValue({ id: 'row-1', vendorId: VENDOR_ID, ...UPDATE_DTO });

    await service.updatePolicy(VENDOR_ID, UPDATE_DTO);

    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        vendorId: VENDOR_ID,
        action: 'UPDATE_COLLECTION_POLICY',
        entity: 'CollectionPolicyConfig',
        entityId: 'row-1',
      }),
    );
  });

  it('a disable-then-re-enable transition is reflected immediately (no stale cache) once invalidated', async () => {
    // 1) Vendor enables the policy — write invalidates cache.
    mockPrisma.collectionPolicyConfig.upsert.mockResolvedValueOnce({
      id: 'row-1',
      vendorId: VENDOR_ID,
      enabled: true,
      minOutstandingThreshold: 1000,
      minCollectionPercentage: 90,
      allowedShortfall: 300,
    });
    await service.updatePolicy(VENDOR_ID, { ...UPDATE_DTO, enabled: true });
    expect(mockCache.del).toHaveBeenCalledTimes(1);

    // 2) A subsequent read, simulating the post-invalidation cache miss, must
    // hit the database and see the freshly-enabled row — never the stale
    // pre-write cached value.
    mockCache.get.mockResolvedValueOnce(undefined);
    mockPrisma.collectionPolicyConfig.findUnique.mockResolvedValueOnce({
      id: 'row-1',
      vendorId: VENDOR_ID,
      enabled: true,
      minOutstandingThreshold: 1000,
      minCollectionPercentage: 90,
      allowedShortfall: 300,
    });
    const afterEnable = await service.getPolicy(VENDOR_ID);
    expect(afterEnable.enabled).toBe(true);

    // 3) Vendor disables the policy — write invalidates cache again.
    mockPrisma.collectionPolicyConfig.upsert.mockResolvedValueOnce({
      id: 'row-1',
      vendorId: VENDOR_ID,
      enabled: false,
      minOutstandingThreshold: 1000,
      minCollectionPercentage: 90,
      allowedShortfall: 300,
    });
    await service.updatePolicy(VENDOR_ID, { ...UPDATE_DTO, enabled: false });
    expect(mockCache.del).toHaveBeenCalledTimes(2);

    // 4) The next read must reflect disabled, not the stale enabled value.
    mockCache.get.mockResolvedValueOnce(undefined);
    mockPrisma.collectionPolicyConfig.findUnique.mockResolvedValueOnce({
      id: 'row-1',
      vendorId: VENDOR_ID,
      enabled: false,
      minOutstandingThreshold: 1000,
      minCollectionPercentage: 90,
      allowedShortfall: 300,
    });
    const afterDisable = await service.getPolicy(VENDOR_ID);
    expect(afterDisable.enabled).toBe(false);
  });
});

/**
 * Unit tests: CollectionPolicyService — the Cash Collection Policy sibling
 * methods (getCashPolicy/updateCashPolicy), per
 * docs/features/cash-customer-collection-policy.md §9.1, §12, §18. Mirrors
 * the monthly suite's structure exactly (same "missing row = disabled"
 * convention, same explicit-invalidation-on-write discipline), plus the one
 * piece of business logic unique to this sibling: the `ceiling >= floor`
 * cross-field validation (§12) that has no monthly analog.
 */
describe('CollectionPolicyService — Cash Collection Policy', () => {
  let service: CollectionPolicyService;
  let mockPrisma: any;
  let mockCache: any;
  let mockAudit: any;

  const VENDOR_ID = 'vendor-001';

  const DEFAULT_CASH_POLICY = {
    enabled: false,
    allowedCreditDeliveries: 2,
    minExposureFloor: 500,
    maxOutstandingCeiling: null,
  };

  beforeEach(async () => {
    mockPrisma = {
      collectionPolicyConfig: { findUnique: jest.fn(), upsert: jest.fn() },
      cashCollectionPolicyConfig: { findUnique: jest.fn(), upsert: jest.fn() },
      customer: { findMany: jest.fn() },
    };
    mockCache = {
      get: jest.fn(),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
    };
    mockAudit = { log: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CollectionPolicyService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: CacheInvalidationService, useValue: mockCache },
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile();

    service = module.get<CollectionPolicyService>(CollectionPolicyService);
  });

  afterEach(() => jest.clearAllMocks());

  // ── getCashPolicy: caching ────────────────────────────────────────────────

  it('returns the cached cash policy without hitting the database on a cache hit', async () => {
    const cached = { ...DEFAULT_CASH_POLICY, enabled: true };
    mockCache.get.mockResolvedValue(cached);

    const result = await service.getCashPolicy(VENDOR_ID);

    expect(result).toEqual(cached);
    expect(mockPrisma.cashCollectionPolicyConfig.findUnique).not.toHaveBeenCalled();
  });

  it('returns the default (disabled) cash policy and caches it when no row exists', async () => {
    mockCache.get.mockResolvedValue(undefined);
    mockPrisma.cashCollectionPolicyConfig.findUnique.mockResolvedValue(null);

    const result = await service.getCashPolicy(VENDOR_ID);

    expect(result).toEqual(DEFAULT_CASH_POLICY);
    expect(mockCache.set).toHaveBeenCalledWith(
      `vendor:${VENDOR_ID}:cash-collection-policy`,
      DEFAULT_CASH_POLICY,
      5 * 60 * 1000,
    );
  });

  it('returns the persisted row values and caches them when a row exists', async () => {
    mockCache.get.mockResolvedValue(undefined);
    const row = {
      id: 'row-1',
      vendorId: VENDOR_ID,
      enabled: true,
      allowedCreditDeliveries: 3,
      minExposureFloor: 750,
      maxOutstandingCeiling: 8000,
    };
    mockPrisma.cashCollectionPolicyConfig.findUnique.mockResolvedValue(row);

    const result = await service.getCashPolicy(VENDOR_ID);

    expect(result).toEqual({
      enabled: true,
      allowedCreditDeliveries: 3,
      minExposureFloor: 750,
      maxOutstandingCeiling: 8000,
    });
    expect(mockCache.set).toHaveBeenCalledWith(
      `vendor:${VENDOR_ID}:cash-collection-policy`,
      result,
      5 * 60 * 1000,
    );
  });

  it('uses a cache key distinct from the monthly policy (no collision)', async () => {
    mockCache.get.mockResolvedValue(undefined);
    mockPrisma.cashCollectionPolicyConfig.findUnique.mockResolvedValue(null);
    mockPrisma.collectionPolicyConfig.findUnique.mockResolvedValue(null);

    await service.getCashPolicy(VENDOR_ID);
    await service.getPolicy(VENDOR_ID);

    expect(mockCache.get).toHaveBeenCalledWith(`vendor:${VENDOR_ID}:cash-collection-policy`);
    expect(mockCache.get).toHaveBeenCalledWith(`vendor:${VENDOR_ID}:collection-policy`);
  });

  it('scopes the cash cache key per vendor', async () => {
    mockCache.get.mockResolvedValue(undefined);
    mockPrisma.cashCollectionPolicyConfig.findUnique.mockResolvedValue(null);

    await service.getCashPolicy('vendor-A');
    await service.getCashPolicy('vendor-B');

    expect(mockCache.get).toHaveBeenCalledWith('vendor:vendor-A:cash-collection-policy');
    expect(mockCache.get).toHaveBeenCalledWith('vendor:vendor-B:cash-collection-policy');
  });

  // ── updateCashPolicy: upsert + cache invalidation + audit ─────────────────

  const UPDATE_CASH_DTO: UpdateCashCollectionPolicyDto = {
    enabled: true,
    allowedCreditDeliveries: 2,
    minExposureFloor: 500,
    maxOutstandingCeiling: null,
  };

  it('upserts the config keyed by vendorId', async () => {
    mockPrisma.cashCollectionPolicyConfig.upsert.mockResolvedValue({ id: 'row-1', vendorId: VENDOR_ID, ...UPDATE_CASH_DTO });

    await service.updateCashPolicy(VENDOR_ID, UPDATE_CASH_DTO);

    expect(mockPrisma.cashCollectionPolicyConfig.upsert).toHaveBeenCalledWith({
      where: { vendorId: VENDOR_ID },
      create: { vendorId: VENDOR_ID, ...UPDATE_CASH_DTO },
      update: { ...UPDATE_CASH_DTO },
    });
  });

  it('invalidates the cash cache on every write (explicit del, not just TTL)', async () => {
    mockPrisma.cashCollectionPolicyConfig.upsert.mockResolvedValue({ id: 'row-1', vendorId: VENDOR_ID, ...UPDATE_CASH_DTO });

    await service.updateCashPolicy(VENDOR_ID, UPDATE_CASH_DTO);

    expect(mockCache.del).toHaveBeenCalledWith(`vendor:${VENDOR_ID}:cash-collection-policy`);
  });

  it('writes an UPDATE_CASH_COLLECTION_POLICY audit entry on every write', async () => {
    mockPrisma.cashCollectionPolicyConfig.upsert.mockResolvedValue({ id: 'row-1', vendorId: VENDOR_ID, ...UPDATE_CASH_DTO });

    await service.updateCashPolicy(VENDOR_ID, UPDATE_CASH_DTO);

    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        vendorId: VENDOR_ID,
        action: 'UPDATE_CASH_COLLECTION_POLICY',
        entity: 'CashCollectionPolicyConfig',
        entityId: 'row-1',
      }),
    );
  });

  // ── ceiling >= floor cross-field validation (§12) — unique to this sibling ─

  describe('maxOutstandingCeiling / minExposureFloor validation', () => {
    it('rejects a ceiling set below the floor (would be silently ineffective)', async () => {
      const badDto: UpdateCashCollectionPolicyDto = {
        enabled: true,
        allowedCreditDeliveries: 2,
        minExposureFloor: 500,
        maxOutstandingCeiling: 300, // < floor
      };

      await expect(service.updateCashPolicy(VENDOR_ID, badDto)).rejects.toBeInstanceOf(BadRequestException);
      expect(mockPrisma.cashCollectionPolicyConfig.upsert).not.toHaveBeenCalled();
      expect(mockCache.del).not.toHaveBeenCalled();
      expect(mockAudit.log).not.toHaveBeenCalled();
    });

    it('accepts a ceiling exactly equal to the floor', async () => {
      const dto: UpdateCashCollectionPolicyDto = {
        enabled: true,
        allowedCreditDeliveries: 2,
        minExposureFloor: 500,
        maxOutstandingCeiling: 500,
      };
      mockPrisma.cashCollectionPolicyConfig.upsert.mockResolvedValue({ id: 'row-1', vendorId: VENDOR_ID, ...dto });

      await expect(service.updateCashPolicy(VENDOR_ID, dto)).resolves.toBeDefined();
      expect(mockPrisma.cashCollectionPolicyConfig.upsert).toHaveBeenCalled();
    });

    it('accepts a null ceiling regardless of the floor value', async () => {
      const dto: UpdateCashCollectionPolicyDto = {
        enabled: true,
        allowedCreditDeliveries: 2,
        minExposureFloor: 999999,
        maxOutstandingCeiling: null,
      };
      mockPrisma.cashCollectionPolicyConfig.upsert.mockResolvedValue({ id: 'row-1', vendorId: VENDOR_ID, ...dto });

      await expect(service.updateCashPolicy(VENDOR_ID, dto)).resolves.toBeDefined();
      expect(mockPrisma.cashCollectionPolicyConfig.upsert).toHaveBeenCalled();
    });
  });

  it('a disable-then-re-enable transition is reflected immediately (no stale cache) once invalidated', async () => {
    mockPrisma.cashCollectionPolicyConfig.upsert.mockResolvedValueOnce({
      id: 'row-1',
      vendorId: VENDOR_ID,
      ...UPDATE_CASH_DTO,
      enabled: true,
    });
    await service.updateCashPolicy(VENDOR_ID, { ...UPDATE_CASH_DTO, enabled: true });
    expect(mockCache.del).toHaveBeenCalledTimes(1);

    mockCache.get.mockResolvedValueOnce(undefined);
    mockPrisma.cashCollectionPolicyConfig.findUnique.mockResolvedValueOnce({
      id: 'row-1',
      vendorId: VENDOR_ID,
      ...UPDATE_CASH_DTO,
      enabled: true,
    });
    const afterEnable = await service.getCashPolicy(VENDOR_ID);
    expect(afterEnable.enabled).toBe(true);

    mockPrisma.cashCollectionPolicyConfig.upsert.mockResolvedValueOnce({
      id: 'row-1',
      vendorId: VENDOR_ID,
      ...UPDATE_CASH_DTO,
      enabled: false,
    });
    await service.updateCashPolicy(VENDOR_ID, { ...UPDATE_CASH_DTO, enabled: false });
    expect(mockCache.del).toHaveBeenCalledTimes(2);

    mockCache.get.mockResolvedValueOnce(undefined);
    mockPrisma.cashCollectionPolicyConfig.findUnique.mockResolvedValueOnce({
      id: 'row-1',
      vendorId: VENDOR_ID,
      ...UPDATE_CASH_DTO,
      enabled: false,
    });
    const afterDisable = await service.getCashPolicy(VENDOR_ID);
    expect(afterDisable.enabled).toBe(false);
  });

  // ── getCashPolicyImpact: §8.1 rollout-guard preview (Phase 2) ─────────────

  describe('getCashPolicyImpact', () => {
    const PROSPECTIVE = { allowedCreditDeliveries: 2, minExposureFloor: 500, maxOutstandingCeiling: undefined };

    it('counts customers who would owe a payment and those over the ₨1,000 threshold', async () => {
      mockPrisma.customer.findMany.mockResolvedValue([
        { financialBalance: 300 },  // within floor -> 0, not counted
        { financialBalance: 700 },  // exposure=700 -> required=230 -> counted, not over threshold
        { financialBalance: 4000 }, // exposure=4000 -> required=floor10(1333.33)=1330 -> counted, over threshold
      ]);

      const result = await service.getCashPolicyImpact(VENDOR_ID, PROSPECTIVE);

      expect(result).toEqual({
        wouldOwePayment: 2,
        wouldOweOverThreshold: 1,
        totalActiveCashCustomers: 3,
      });
    });

    it('queries only active, non-billing-exempt CASH customers for this vendor', async () => {
      mockPrisma.customer.findMany.mockResolvedValue([]);

      await service.getCashPolicyImpact(VENDOR_ID, PROSPECTIVE);

      expect(mockPrisma.customer.findMany).toHaveBeenCalledWith({
        where: { vendorId: VENDOR_ID, paymentType: 'CASH', isBillingExempt: false, isActive: true },
        select: { financialBalance: true },
      });
    });

    it('returns all zeros when there are no active CASH customers', async () => {
      mockPrisma.customer.findMany.mockResolvedValue([]);

      const result = await service.getCashPolicyImpact(VENDOR_ID, PROSPECTIVE);

      expect(result).toEqual({ wouldOwePayment: 0, wouldOweOverThreshold: 0, totalActiveCashCustomers: 0 });
    });

    it('respects a prospective ceiling even though it is never persisted', async () => {
      mockPrisma.customer.findMany.mockResolvedValue([{ financialBalance: 9000 }]);

      // Without a ceiling: exposure=9000 -> proportional=3000. With ceiling=5000: ceilingTerm=4000 wins -> 4000, still > 1000.
      const withoutCeiling = await service.getCashPolicyImpact(VENDOR_ID, PROSPECTIVE);
      const withCeiling = await service.getCashPolicyImpact(VENDOR_ID, { ...PROSPECTIVE, maxOutstandingCeiling: 5000 });

      expect(withoutCeiling.wouldOweOverThreshold).toBe(1);
      expect(withCeiling.wouldOweOverThreshold).toBe(1);
      expect(mockPrisma.cashCollectionPolicyConfig.upsert).not.toHaveBeenCalled(); // never writes
    });
  });
});
