import { AuthzPolicyService } from './authz-policy.service';
import { ForbiddenException, ConflictException } from '@nestjs/common';
import type { AuthUser } from '@water-supply-crm/types';

const actor: AuthUser = {
  userId: 'a', email: 'a@x.com', name: 'A', role: 'VENDOR_ADMIN' as never, vendorId: 'v1', customerId: null,
};

function policyWith(effective: string[], prismaOver: Record<string, unknown> = {}) {
  const permissions = { getEffectivePermissions: jest.fn(async () => effective) };
  const prisma: any = {
    role: { findMany: jest.fn(async () => []) },
    user: { findMany: jest.fn(async () => []), count: jest.fn(async () => 0) },
    ...prismaOver,
  };
  return new AuthzPolicyService(prisma as never, permissions as never);
}

describe('AuthzPolicyService — privilege escalation', () => {
  it('allows granting permissions the actor holds', async () => {
    const p = policyWith(['customers:view', 'customers:create']);
    await expect(p.assertActorCanGrant(actor, ['customers:view'])).resolves.toBeUndefined();
  });

  it('rejects granting a permission the actor lacks', async () => {
    const p = policyWith(['customers:view']);
    await expect(p.assertActorCanGrant(actor, ['payments:approve'])).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a wildcard grant that exceeds the actor’s permissions', async () => {
    const p = policyWith(['customers:view', 'customers:create']); // not all customers actions
    await expect(p.assertActorCanGrant(actor, ['customers:*'])).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('empty grant list is a no-op', async () => {
    const p = policyWith([]);
    await expect(p.assertActorCanGrant(actor, [])).resolves.toBeUndefined();
  });

  it('patternsConferAdmin detects admin-conferring permission sets', () => {
    const p = policyWith([]);
    expect(p.patternsConferAdmin(['*'])).toBe(true);
    expect(p.patternsConferAdmin(['users:create'])).toBe(true);
    expect(p.patternsConferAdmin(['roles:update'])).toBe(true);
    expect(p.patternsConferAdmin(['customers:view', 'orders:approve'])).toBe(false);
  });
});

describe('AuthzPolicyService — last-admin protection', () => {
  function withAdmins(adminRoleIds: string[], activeUserIds: string[]) {
    return policyWith([], {
      role: { findMany: jest.fn(async () => adminRoleIds.map((id) => ({ id }))) },
      user: {
        findMany: jest.fn(async () => activeUserIds.map((id) => ({ id }))),
        count: jest.fn(async () => activeUserIds.length),
      },
    });
  }

  it('blocks deactivating/deleting the last admin', async () => {
    const p = withAdmins(['adminRole'], ['u1']);
    await expect(p.assertNotLastAdmin('v1', 'u1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('allows removing an admin when another admin remains', async () => {
    const p = withAdmins(['adminRole'], ['u1', 'u2']);
    await expect(p.assertNotLastAdmin('v1', 'u1')).resolves.toBeUndefined();
  });

  it('allows removing a non-admin user', async () => {
    const p = withAdmins(['adminRole'], ['u1']);
    await expect(p.assertNotLastAdmin('v1', 'someoneElse')).resolves.toBeUndefined();
  });

  it('skips the check for platform (null-vendor) users', async () => {
    const p = withAdmins(['adminRole'], ['u1']);
    await expect(p.assertNotLastAdmin(null, 'u1')).resolves.toBeUndefined();
  });

  it('blocks moving the last admin to a non-admin role', async () => {
    // getAdminUserIds → [u1]; isRoleAdminCapable(newRole) → false (findMany returns [])
    const permissions = { getEffectivePermissions: jest.fn(async () => []) };
    const prisma: any = {
      role: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([{ id: 'adminRole' }]) // getAdminUserIds → admin roles
          .mockResolvedValueOnce([]), // isRoleAdminCapable(newRole) → not admin
      },
      user: { findMany: jest.fn(async () => [{ id: 'u1' }]), count: jest.fn(async () => 1) },
    };
    const p = new AuthzPolicyService(prisma as never, permissions as never);
    await expect(p.assertReassignmentKeepsAdmin('v1', 'u1', 'newRole')).rejects.toBeInstanceOf(ConflictException);
  });
});
