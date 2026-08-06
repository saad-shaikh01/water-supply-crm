import 'reflect-metadata';
import axios from 'axios';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { PassportModule } from '@nestjs/passport';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PrismaService } from '@water-supply-crm/database';
import { CacheInvalidationService } from '@water-supply-crm/caching';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { JwtStrategy } from '../auth/jwt.strategy';
import { PermissionService } from '../authz/permission.service';
import { StaffLedgerController } from './staff-ledger.controller';
import { StaffLedgerService } from './staff-ledger.service';
import { PayrollPeriodController } from './payroll-period.controller';
import { PayrollPeriodService } from './payroll-period.service';
import { PayrollEntryController } from './payroll-entry.controller';
import { PayrollEntryService } from './payroll-entry.service';
import { SettlementController } from './settlement.controller';
import { SettlementService } from './settlement.service';

/**
 * Real end-to-end authorization test: a compiled `TestingModule` running the
 * ACTUAL `JwtAuthGuard` + `PermissionsGuard` pair as `APP_GUARD` (the exact
 * global pipeline `app.module.ts` wires up), a REAL `Reflector`, a REAL
 * `JwtStrategy` (passport-jwt, signature-verified against a real signed
 * token), and a REAL `PermissionService` (only its `PrismaService`/
 * `CacheInvalidationService` dependencies are stubbed — no live DB/Redis).
 * Only the payroll business logic underneath (`StaffLedgerService`,
 * `PayrollPeriodService`, `PayrollEntryService`) is stubbed, because this
 * test exercises AUTHORIZATION, not payroll computation. Requests hit a real
 * `http.Server` (via `app.listen`), so this is not calling `canActivate()`
 * directly or stubbing the Reflector — every layer between the HTTP request
 * and the controller method is the genuine Nest runtime.
 *
 * No existing precedent for this style was found in the repo (the only
 * other e2e project, `api-backend-e2e`, drives a live, separately-started
 * server + real Postgres via `axios` — unsuitable for a self-contained authz
 * unit-style test), so this mirrors that project's "axios over a real HTTP
 * server" shape while keeping everything else self-contained and mocked at
 * the DB/cache boundary only.
 */

const JWT_SECRET_FOR_TEST = 'payroll-authz-e2e-test-secret';
const VENDOR_ID = 'vendor-001';

const ADMIN_USER_ID = 'admin-001';
const DRIVER_USER_ID = 'driver-001';

/** Minimal PrismaService stand-in — only `user.findUnique` is exercised (by PermissionService). */
function makeFakePrisma() {
  const usersById: Record<string, unknown> = {
    [ADMIN_USER_ID]: {
      id: ADMIN_USER_ID,
      roleRef: { permissions: [{ permission: '*' }] }, // vendor_admin preset
      permissionOverrides: [],
    },
    [DRIVER_USER_ID]: {
      id: DRIVER_USER_ID,
      roleRef: { permissions: [] }, // driver preset holds no payroll:* grants
      permissionOverrides: [],
    },
  };
  return {
    user: {
      findUnique: jest.fn(async ({ where: { id } }: { where: { id: string } }) => usersById[id] ?? null),
    },
  };
}

/** No-op cache — PermissionService always resolves fresh; JwtStrategy's suspension check always passes. */
function makeFakeCache() {
  return {
    get: jest.fn().mockResolvedValue(undefined),
    set: jest.fn().mockResolvedValue(undefined),
    del: jest.fn().mockResolvedValue(undefined),
  };
}

describe('Payroll routes — real APP_GUARD pipeline (JwtAuthGuard + PermissionsGuard)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let adminToken: string;
  let driverToken: string;
  let staffLedgerService: { create: jest.Mock };
  let payrollPeriodService: { lockPeriod: jest.Mock };
  let payrollEntryService: { listForPeriod: jest.Mock };
  let settlementService: { record: jest.Mock };
  const originalJwtSecret = process.env.JWT_SECRET;

  beforeAll(async () => {
    process.env.JWT_SECRET = JWT_SECRET_FOR_TEST;

    staffLedgerService = { create: jest.fn().mockResolvedValue({ id: 'entry-001', status: 'POSTED' }) };
    payrollPeriodService = {
      lockPeriod: jest.fn().mockResolvedValue({ period: { id: 'period-001' }, lockedEntryCount: 0 }),
    };
    payrollEntryService = { listForPeriod: jest.fn().mockResolvedValue([]) };
    settlementService = { record: jest.fn().mockResolvedValue({ id: 'settlement-001', amount: 5000 }) };

    const moduleRef = await Test.createTestingModule({
      imports: [
        PassportModule.register({ defaultStrategy: 'jwt' }),
        JwtModule.register({ secret: JWT_SECRET_FOR_TEST, signOptions: { expiresIn: '1h' } }),
      ],
      controllers: [
        StaffLedgerController,
        PayrollPeriodController,
        PayrollEntryController,
        SettlementController,
      ],
      providers: [
        Reflector,
        JwtStrategy,
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: PermissionsGuard },
        PermissionService,
        { provide: PrismaService, useValue: makeFakePrisma() },
        { provide: CacheInvalidationService, useValue: makeFakeCache() },
        { provide: StaffLedgerService, useValue: staffLedgerService },
        { provide: PayrollPeriodService, useValue: payrollPeriodService },
        { provide: PayrollEntryService, useValue: payrollEntryService },
        { provide: SettlementService, useValue: settlementService },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    await app.listen(0, '127.0.0.1');

    const address = app.getHttpServer().address();
    const port = typeof address === 'object' && address ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;

    const jwtService = app.get(JwtService);
    adminToken = jwtService.sign({
      sub: ADMIN_USER_ID,
      email: 'admin@example.com',
      name: 'Admin',
      role: 'VENDOR_ADMIN',
      vendorId: VENDOR_ID,
    });
    driverToken = jwtService.sign({
      sub: DRIVER_USER_ID,
      email: 'driver@example.com',
      name: 'Driver',
      role: 'DRIVER',
      vendorId: VENDOR_ID,
    });
  });

  afterAll(async () => {
    await app.close();
    if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalJwtSecret;
  });

  function authed(token: string) {
    return { headers: { Authorization: `Bearer ${token}` }, validateStatus: () => true };
  }

  // ── 1. Ledger-entry mutation: POST /payroll/ledger-entries (payroll:ledger_create) ──

  describe('POST /payroll/ledger-entries', () => {
    const validBody = {
      userId: 'e58ed763-928c-4155-bee9-fdbaaadc15f3',
      category: 'BONUS',
      amount: 1000,
      effectiveDate: '2026-08-01',
    };

    it('VENDOR_ADMIN (wildcard grant) → 201, handler reached', async () => {
      const res = await axios.post(`${baseUrl}/payroll/ledger-entries`, validBody, authed(adminToken));
      expect(res.status).toBe(201);
      expect(staffLedgerService.create).toHaveBeenCalled();
    });

    it('DRIVER (no payroll:ledger_create grant) → 403, handler never reached', async () => {
      staffLedgerService.create.mockClear();
      const res = await axios.post(`${baseUrl}/payroll/ledger-entries`, validBody, authed(driverToken));
      expect(res.status).toBe(403);
      expect(staffLedgerService.create).not.toHaveBeenCalled();
    });

    it('no token → 401 (JwtAuthGuard rejects before PermissionsGuard ever runs)', async () => {
      const res = await axios.post(`${baseUrl}/payroll/ledger-entries`, validBody, { validateStatus: () => true });
      expect(res.status).toBe(401);
    });
  });

  // ── 2. Period lock: PATCH /payroll/periods/:id/lock (payroll:period_lock) ──

  describe('PATCH /payroll/periods/:id/lock', () => {
    it('VENDOR_ADMIN (wildcard grant) → 200, handler reached', async () => {
      const res = await axios.patch(`${baseUrl}/payroll/periods/period-001/lock`, {}, authed(adminToken));
      expect(res.status).toBe(200);
      expect(payrollPeriodService.lockPeriod).toHaveBeenCalled();
    });

    it('DRIVER (no payroll:period_lock grant) → 403, handler never reached', async () => {
      payrollPeriodService.lockPeriod.mockClear();
      const res = await axios.patch(`${baseUrl}/payroll/periods/period-001/lock`, {}, authed(driverToken));
      expect(res.status).toBe(403);
      expect(payrollPeriodService.lockPeriod).not.toHaveBeenCalled();
    });
  });

  // ── 3. Read endpoint: GET /payroll/periods/:periodId/entries (payroll:view_all) ──

  describe('GET /payroll/periods/:periodId/entries', () => {
    it('VENDOR_ADMIN (wildcard grant) → 200, handler reached', async () => {
      const res = await axios.get(`${baseUrl}/payroll/periods/period-001/entries`, authed(adminToken));
      expect(res.status).toBe(200);
      expect(payrollEntryService.listForPeriod).toHaveBeenCalled();
    });

    it('DRIVER (no payroll:view_all grant) → 403, handler never reached', async () => {
      payrollEntryService.listForPeriod.mockClear();
      const res = await axios.get(`${baseUrl}/payroll/periods/period-001/entries`, authed(driverToken));
      expect(res.status).toBe(403);
      expect(payrollEntryService.listForPeriod).not.toHaveBeenCalled();
    });
  });

  // ── 4. Settlement mutation: POST /payroll/entries/:id/settlements (payroll:settlement_record) ──

  describe('POST /payroll/entries/:id/settlements', () => {
    const validBody = { amount: 5000, method: 'CASH' };

    it('VENDOR_ADMIN (wildcard grant) → 201, handler reached', async () => {
      const res = await axios.post(`${baseUrl}/payroll/entries/entry-001/settlements`, validBody, authed(adminToken));
      expect(res.status).toBe(201);
      expect(settlementService.record).toHaveBeenCalled();
    });

    it('DRIVER (no payroll:settlement_record grant) → 403, handler never reached', async () => {
      settlementService.record.mockClear();
      const res = await axios.post(`${baseUrl}/payroll/entries/entry-001/settlements`, validBody, authed(driverToken));
      expect(res.status).toBe(403);
      expect(settlementService.record).not.toHaveBeenCalled();
    });

    it('no token → 401 (JwtAuthGuard rejects before PermissionsGuard ever runs)', async () => {
      const res = await axios.post(`${baseUrl}/payroll/entries/entry-001/settlements`, validBody, {
        validateStatus: () => true,
      });
      expect(res.status).toBe(401);
    });
  });
});
