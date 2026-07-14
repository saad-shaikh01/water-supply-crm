import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '@water-supply-crm/database';
import { CacheInvalidationService } from '@water-supply-crm/caching';
import { CollectionPolicyService } from './collection-policy.service';
import { AuditService } from '../audit/audit.service';
import { UpdateCollectionPolicyDto } from './dto/update-collection-policy.dto';

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
