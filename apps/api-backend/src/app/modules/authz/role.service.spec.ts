import { RoleService } from './role.service';
import {
  ConflictException,
  ForbiddenException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '@water-supply-crm/types';

const actor: AuthUser = {
  userId: 'admin1',
  email: 'a@x.com',
  name: 'Admin',
  role: 'VENDOR_ADMIN' as never,
  vendorId: 'v1',
  customerId: null,
};

function roleObj(over: Record<string, unknown> = {}) {
  return {
    id: 'r1',
    vendorId: 'v1',
    name: 'Sales',
    description: null,
    color: null,
    key: 'custom_abc',
    isSystem: false,
    permissions: [{ permission: 'customers:view' }],
    _count: { users: 0 },
    ...over,
  };
}

function makePrisma() {
  const prisma: any = {
    role: {
      findMany: jest.fn(),
      findUnique: jest.fn().mockResolvedValue(roleObj()),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'r1' }),
      update: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({}),
    },
    rolePermission: { createMany: jest.fn(), deleteMany: jest.fn() },
    user: { findMany: jest.fn().mockResolvedValue([]) },
  };
  prisma.$transaction = jest.fn(async (fn: any) => fn(prisma));
  return prisma;
}

function makeDeps() {
  const permissions = { invalidateRole: jest.fn(), invalidateUser: jest.fn() };
  const audit = { log: jest.fn() };
  return { permissions, audit };
}

// Permissive policy by default (privilege-escalation / last-admin checks pass);
// individual tests can override to assert a specific guardrail.
function makePolicy(over: Record<string, unknown> = {}) {
  return {
    assertActorCanGrant: jest.fn(),
    patternsConferAdmin: jest.fn(() => false),
    assertAdminSurvivesRoleChange: jest.fn(),
    ...over,
  };
}

function svc(prisma: any, permissions: any, audit: any, policy: any = makePolicy()) {
  return new RoleService(prisma, permissions as never, audit as never, policy as never);
}

describe('RoleService', () => {
  it('create: persists role + deduped permissions, audits CREATE', async () => {
    const prisma = makePrisma();
    const { permissions, audit } = makeDeps();
    await svc(prisma, permissions, audit).create(actor, {
      name: 'Sales',
      permissions: ['customers:view', 'customers:view', 'orders:view'],
    });

    expect(prisma.rolePermission.createMany).toHaveBeenCalledWith({
      data: [
        { roleId: 'r1', permission: 'customers:view' },
        { roleId: 'r1', permission: 'orders:view' },
      ],
      skipDuplicates: true,
    });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'CREATE', entity: 'Role' }));
  });

  it('create: rejects when the actor cannot grant a requested permission (privilege escalation)', async () => {
    const prisma = makePrisma();
    const { permissions, audit } = makeDeps();
    const policy = makePolicy({
      assertActorCanGrant: jest.fn().mockRejectedValue(new ForbiddenException('nope')),
    });
    await expect(
      svc(prisma, permissions, audit, policy).create(actor, { name: 'X', permissions: ['payments:approve'] }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.role.create).not.toHaveBeenCalled();
  });

  it('create: rejects a duplicate role name in the same vendor', async () => {
    const prisma = makePrisma();
    prisma.role.findFirst.mockResolvedValue({ id: 'other' });
    const { permissions, audit } = makeDeps();
    await expect(
      svc(prisma, permissions, audit).create(actor, { name: 'Sales', permissions: [] }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('update: invalidates role cache ONLY when permissions change', async () => {
    // permissions changed
    const p1 = makePrisma();
    const d1 = makeDeps();
    await svc(p1, d1.permissions, d1.audit).update(actor, 'r1', { permissions: ['orders:view'] });
    expect(d1.permissions.invalidateRole).toHaveBeenCalledWith('r1');

    // name-only change → no invalidation
    const p2 = makePrisma();
    const d2 = makeDeps();
    await svc(p2, d2.permissions, d2.audit).update(actor, 'r1', { name: 'Sales Team' });
    expect(d2.permissions.invalidateRole).not.toHaveBeenCalled();
    expect(d2.audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'UPDATE' }));
  });

  it('remove: blocks system roles', async () => {
    const prisma = makePrisma();
    prisma.role.findUnique.mockResolvedValue(roleObj({ isSystem: true }));
    const { permissions, audit } = makeDeps();
    await expect(svc(prisma, permissions, audit).remove(actor, 'r1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('remove: blocks roles that still have members', async () => {
    const prisma = makePrisma();
    prisma.role.findUnique.mockResolvedValue(roleObj({ _count: { users: 3 } }));
    const { permissions, audit } = makeDeps();
    await expect(svc(prisma, permissions, audit).remove(actor, 'r1')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('remove: deletes an unused custom role and audits DELETE', async () => {
    const prisma = makePrisma();
    const { permissions, audit } = makeDeps();
    await svc(prisma, permissions, audit).remove(actor, 'r1');
    expect(prisma.role.delete).toHaveBeenCalledWith({ where: { id: 'r1' } });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'DELETE' }));
  });

  it('clone: creates an independent custom role copying source permissions', async () => {
    const prisma = makePrisma();
    prisma.role.findUnique.mockResolvedValue(
      roleObj({ id: 'src', permissions: [{ permission: 'orders:view' }, { permission: 'orders:approve' }] }),
    );
    prisma.role.create.mockResolvedValue({ id: 'clone1' });
    const { permissions, audit } = makeDeps();
    await svc(prisma, permissions, audit).clone(actor, 'src', { name: 'Ops Copy' });

    const createArg = prisma.role.create.mock.calls[0][0];
    expect(createArg.data.isSystem).toBe(false); // independent, never a system role
    expect(createArg.data.name).toBe('Ops Copy');
    expect(prisma.rolePermission.createMany).toHaveBeenCalledWith({
      data: [
        { roleId: 'clone1', permission: 'orders:view' },
        { roleId: 'clone1', permission: 'orders:approve' },
      ],
      skipDuplicates: true,
    });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'CLONE' }));
  });

  it('reset: rejects non-system roles', async () => {
    const prisma = makePrisma();
    prisma.role.findUnique.mockResolvedValue(roleObj({ isSystem: false }));
    const { permissions, audit } = makeDeps();
    await expect(svc(prisma, permissions, audit).resetToPreset(actor, 'r1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('reset: re-applies the preset for a system role and invalidates cache', async () => {
    const prisma = makePrisma();
    prisma.role.findUnique.mockResolvedValue(roleObj({ isSystem: true, key: 'manager' }));
    const { permissions, audit } = makeDeps();
    await svc(prisma, permissions, audit).resetToPreset(actor, 'r1');

    expect(prisma.rolePermission.deleteMany).toHaveBeenCalledWith({ where: { roleId: 'r1' } });
    expect(prisma.rolePermission.createMany).toHaveBeenCalled();
    expect(permissions.invalidateRole).toHaveBeenCalledWith('r1');
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'RESET' }));
  });

  it('tenant isolation: cannot read another vendor’s role', async () => {
    const prisma = makePrisma();
    prisma.role.findUnique.mockResolvedValue(roleObj({ vendorId: 'v2' }));
    const { permissions, audit } = makeDeps();
    await expect(svc(prisma, permissions, audit).findOne(actor, 'r1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
