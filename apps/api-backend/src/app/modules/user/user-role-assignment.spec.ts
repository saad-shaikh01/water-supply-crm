import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { AuthUser } from '@water-supply-crm/types';
import { UserService, assertCanAssignRole } from './user.service';
import { UserController } from './user.controller';

/**
 * Regression suite for audit finding C1 (docs/features/tenant-isolation-audit.md): any VENDOR_ADMIN
 * held `users:create` / `users:update` (via `*`) and could mint or promote a SUPER_ADMIN, which then
 * passed `@RequireSuperAdmin()` (role claim only) and owned every tenant.
 */
const actor = (role: UserRole, vendorId: string | null = 'v1'): AuthUser => ({
  userId: 'actor-1',
  email: 'actor@x.test',
  name: 'Actor',
  role: role as never,
  vendorId: vendorId as never,
  customerId: null,
});
const vendorAdmin = actor(UserRole.VENDOR_ADMIN);
const superAdmin = actor(UserRole.SUPER_ADMIN, null);

function makeService(existing: { id: string; role: UserRole; vendorId: string | null; roleId?: string | null } | null) {
  const prisma = {
    user: {
      findUnique: jest.fn(async () => null),
      findFirst: jest.fn(async () => existing),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'new-user', ...data })),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: existing?.id ?? 'x', ...data })),
    },
    role: { findFirst: jest.fn(async () => ({ id: 'role-1' })) },
  };
  const cache = { invalidateVendorEntity: jest.fn(), set: jest.fn(), del: jest.fn() };
  const audit = { log: jest.fn() };
  const permissions = { invalidateUser: jest.fn() };
  const svc = new UserService(prisma as never, cache as never, audit as never, permissions as never, {} as never);
  return { svc, prisma };
}

const newUser = (role: UserRole) => ({
  email: `u-${role}@x.test`,
  password: 'Password123!',
  name: 'New User',
  role,
  vendorId: 'v1',
});

describe('assertCanAssignRole', () => {
  it('blocks SUPER_ADMIN for VENDOR_ADMIN, STAFF and when there is no actor (fails closed)', () => {
    expect(() => assertCanAssignRole(vendorAdmin, UserRole.SUPER_ADMIN)).toThrow(ForbiddenException);
    expect(() => assertCanAssignRole(actor(UserRole.STAFF), UserRole.SUPER_ADMIN)).toThrow(ForbiddenException);
    expect(() => assertCanAssignRole(undefined, UserRole.SUPER_ADMIN)).toThrow(ForbiddenException);
  });

  it('allows a SUPER_ADMIN to assign SUPER_ADMIN', () => {
    expect(() => assertCanAssignRole(superAdmin, UserRole.SUPER_ADMIN)).not.toThrow();
  });

  it('never allows CUSTOMER here (portal accounts come from activation) — not even for SUPER_ADMIN', () => {
    expect(() => assertCanAssignRole(vendorAdmin, UserRole.CUSTOMER)).toThrow(BadRequestException);
    expect(() => assertCanAssignRole(superAdmin, UserRole.CUSTOMER)).toThrow(BadRequestException);
  });

  it.each([UserRole.VENDOR_ADMIN, UserRole.STAFF, UserRole.DRIVER, UserRole.SALESMAN, UserRole.LOADER])(
    'still allows a vendor admin to assign the ordinary vendor role %s',
    (role) => {
      expect(() => assertCanAssignRole(vendorAdmin, role)).not.toThrow();
    },
  );
});

describe('UserService.create — role escalation', () => {
  it('VENDOR_ADMIN cannot create a SUPER_ADMIN (and nothing is written)', async () => {
    const { svc, prisma } = makeService(null);
    await expect(svc.create(newUser(UserRole.SUPER_ADMIN), vendorAdmin)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('a call with no actor cannot create a SUPER_ADMIN either', async () => {
    const { svc, prisma } = makeService(null);
    await expect(svc.create(newUser(UserRole.SUPER_ADMIN))).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('VENDOR_ADMIN cannot create a CUSTOMER-role user', async () => {
    const { svc, prisma } = makeService(null);
    await expect(svc.create(newUser(UserRole.CUSTOMER), vendorAdmin)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('VENDOR_ADMIN can still create ordinary staff', async () => {
    const { svc, prisma } = makeService(null);
    const created = await svc.create(newUser(UserRole.STAFF), vendorAdmin);
    expect(prisma.user.create).toHaveBeenCalledTimes(1);
    expect(created.role).toBe(UserRole.STAFF);
  });

  it('SUPER_ADMIN can still create a SUPER_ADMIN (platform user, no vendor)', async () => {
    const { svc, prisma } = makeService(null);
    const created = await svc.create({ ...newUser(UserRole.SUPER_ADMIN), vendorId: undefined }, superAdmin);
    expect(prisma.user.create).toHaveBeenCalledTimes(1);
    expect(created.role).toBe(UserRole.SUPER_ADMIN);
  });
});

describe('UserService.update — role escalation', () => {
  const staff = { id: 'u1', role: UserRole.STAFF, vendorId: 'v1' };

  it('VENDOR_ADMIN cannot promote an existing user to SUPER_ADMIN (nothing is written)', async () => {
    const { svc, prisma } = makeService(staff);
    await expect(svc.update('v1', 'u1', { role: UserRole.SUPER_ADMIN }, vendorAdmin)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('a vendor admin cannot self-promote either', async () => {
    const { svc, prisma } = makeService({ id: 'actor-1', role: UserRole.VENDOR_ADMIN, vendorId: 'v1' });
    await expect(svc.update('v1', 'actor-1', { role: UserRole.SUPER_ADMIN }, vendorAdmin)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('VENDOR_ADMIN cannot modify an existing SUPER_ADMIN account (e.g. reset its password)', async () => {
    const { svc, prisma } = makeService({ id: 'sa', role: UserRole.SUPER_ADMIN, vendorId: 'v1' });
    await expect(svc.update('v1', 'sa', { password: 'NewPassword123!' }, vendorAdmin)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('VENDOR_ADMIN can still change an ordinary role and edit ordinary users', async () => {
    const { svc, prisma } = makeService(staff);
    await svc.update('v1', 'u1', { role: UserRole.DRIVER }, vendorAdmin);
    await svc.update('v1', 'u1', { name: 'Renamed' }, vendorAdmin);
    expect(prisma.user.update).toHaveBeenCalledTimes(2);
  });

  it('SUPER_ADMIN can still promote to SUPER_ADMIN and manage a SUPER_ADMIN account', async () => {
    const { svc, prisma } = makeService(staff);
    await svc.update('v1', 'u1', { role: UserRole.SUPER_ADMIN }, superAdmin);
    expect(prisma.user.update).toHaveBeenCalledTimes(1);

    const { svc: svc2, prisma: prisma2 } = makeService({ id: 'sa', role: UserRole.SUPER_ADMIN, vendorId: 'v1' });
    await svc2.update('v1', 'sa', { name: 'Platform Admin' }, superAdmin);
    expect(prisma2.user.update).toHaveBeenCalledTimes(1);
  });
});

describe('UserController wiring', () => {
  it('passes the authenticated caller to the service, so the role guard actually engages', async () => {
    const service = { create: jest.fn(async () => ({})), update: jest.fn(async () => ({})) };
    const controller = new UserController(service as never);

    await controller.create(vendorAdmin, newUser(UserRole.STAFF) as never);
    expect(service.create).toHaveBeenCalledWith(expect.objectContaining({ vendorId: 'v1' }), vendorAdmin);

    await controller.update(vendorAdmin, 'u1', { name: 'x' } as never);
    expect(service.update).toHaveBeenCalledWith('v1', 'u1', { name: 'x' }, vendorAdmin);
  });
});
