import { UserPermissionService } from './user-permission.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '@water-supply-crm/types';

const actor: AuthUser = {
  userId: 'admin1',
  email: 'a@x.com',
  name: 'Admin',
  role: 'VENDOR_ADMIN' as never,
  vendorId: 'v1',
  customerId: null,
};

function makePrisma() {
  const prisma: any = {
    user: {
      findUnique: jest.fn().mockResolvedValue({ id: 'u1', vendorId: 'v1', name: 'Bob', roleId: 'old' }),
      update: jest.fn().mockResolvedValue({}),
    },
    role: { findUnique: jest.fn().mockResolvedValue({ id: 'r1', vendorId: 'v1', name: 'Sales', key: 'x', permissions: [] }) },
    userPermissionOverride: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
  };
  prisma.$transaction = jest.fn(async (fn: any) => fn(prisma));
  return prisma;
}

function makeDeps() {
  const permissions = {
    invalidateUser: jest.fn(),
    getEffectivePermissions: jest.fn().mockResolvedValue(['customers:page', 'customers:view']),
  };
  const audit = { log: jest.fn() };
  return { permissions, audit };
}

function makePolicy(over: Record<string, unknown> = {}) {
  return {
    assertActorCanGrant: jest.fn(),
    assertReassignmentKeepsAdmin: jest.fn(),
    ...over,
  };
}

function svc(prisma: any, permissions: any, audit: any, policy: any = makePolicy()) {
  return new UserPermissionService(prisma, permissions as never, audit as never, policy as never);
}

describe('UserPermissionService', () => {
  it('assignRole: sets roleId, invalidates the user cache, audits ASSIGN_ROLE', async () => {
    const prisma = makePrisma();
    const { permissions, audit } = makeDeps();
    await svc(prisma, permissions, audit).assignRole(actor, 'u1', 'r1');

    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { roleId: 'r1' } });
    expect(permissions.invalidateUser).toHaveBeenCalledWith('u1');
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'ASSIGN_ROLE', entity: 'User' }));
  });

  it('assignRole: a vendor admin cannot even reference another vendor’s role (tenant-isolated)', async () => {
    const prisma = makePrisma();
    prisma.role.findUnique.mockResolvedValue({ id: 'r1', vendorId: 'v2', name: 'X' });
    const { permissions, audit } = makeDeps();
    // assertTenant fires first → NotFound (the role is invisible to this actor)
    await expect(svc(prisma, permissions, audit).assignRole(actor, 'u1', 'r1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('assignRole: super_admin cannot assign a role to a user of a different vendor', async () => {
    const superAdmin: AuthUser = { ...actor, vendorId: null as never };
    const prisma = makePrisma();
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', vendorId: 'v1', name: 'Bob', roleId: null });
    prisma.role.findUnique.mockResolvedValue({ id: 'r1', vendorId: 'v2', name: 'X' });
    const { permissions, audit } = makeDeps();
    await expect(svc(prisma, permissions, audit).assignRole(superAdmin, 'u1', 'r1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('setOverrides: replaces overrides, invalidates cache, audits', async () => {
    const prisma = makePrisma();
    const { permissions, audit } = makeDeps();
    await svc(prisma, permissions, audit).setOverrides(actor, 'u1', {
      overrides: [{ permission: 'payments:approve', effect: 'DENY' as never }],
    });

    expect(prisma.userPermissionOverride.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
    expect(prisma.userPermissionOverride.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          userId: 'u1',
          permission: 'payments:approve',
          effect: 'DENY',
          grantedById: 'admin1',
        }),
      ],
      skipDuplicates: true,
    });
    expect(permissions.invalidateUser).toHaveBeenCalledWith('u1');
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'UPDATE_OVERRIDES' }));
  });

  it('setOverrides: rejects a past expiresAt', async () => {
    const prisma = makePrisma();
    const { permissions, audit } = makeDeps();
    await expect(
      svc(prisma, permissions, audit).setOverrides(actor, 'u1', {
        overrides: [{ permission: 'payments:approve', effect: 'ALLOW' as never, expiresAt: '2000-01-01T00:00:00Z' }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.userPermissionOverride.createMany).not.toHaveBeenCalled();
  });

  it('getEffective: returns the resolved set from PermissionService with page permissions split out', async () => {
    const prisma = makePrisma();
    const { permissions, audit } = makeDeps();
    const result = await svc(prisma, permissions, audit).getEffective(actor, 'u1');
    expect(result.permissions).toEqual(['customers:page', 'customers:view']);
    expect(result.pagePermissions).toEqual(['customers:page']);
  });
});
