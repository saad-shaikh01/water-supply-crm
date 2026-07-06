import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CrewRole, UserRole } from '@prisma/client';
import { PrismaService } from '@water-supply-crm/database';

export interface CrewMemberInput {
  userId: string;
  role: CrewRole;
}

// Max members per supporting-crew role. Service-layer constants (not schema)
// so limits can evolve without a migration.
export const SUPPORT_CREW_LIMITS: Partial<Record<CrewRole, number>> = {
  [CrewRole.SALESMAN]: 1,
  [CrewRole.LOADER]: 2,
};

// Which user (auth) roles may fill each crew role. Spare drivers/salesmen are
// allowed to ride along in "lower" crew roles.
const ALLOWED_USER_ROLES: Partial<Record<CrewRole, UserRole[]>> = {
  [CrewRole.SALESMAN]: [UserRole.SALESMAN, UserRole.DRIVER],
  [CrewRole.LOADER]: [UserRole.LOADER, UserRole.SALESMAN, UserRole.DRIVER],
};

/**
 * Validates a supporting-crew list (salesman/loaders — never the driver):
 * duplicates, per-role limits, tenancy, active status, and role compatibility.
 * `excludeUserId` is the sheet/van driver — they cannot also be crew.
 * Returns the validated users keyed by id (for audit logging / responses).
 */
export async function validateSupportCrew(
  prisma: PrismaService,
  vendorId: string,
  crew: CrewMemberInput[],
  excludeUserId?: string | null,
) {
  if (crew.some((m) => m.role === CrewRole.DRIVER)) {
    throw new BadRequestException('The driver is assigned separately and cannot be part of the supporting crew');
  }

  const ids = crew.map((m) => m.userId);
  if (new Set(ids).size !== ids.length) {
    throw new BadRequestException('The same person cannot appear in the crew twice');
  }
  if (excludeUserId && ids.includes(excludeUserId)) {
    throw new BadRequestException('The driver cannot also be assigned as supporting crew');
  }

  for (const [role, limit] of Object.entries(SUPPORT_CREW_LIMITS)) {
    const count = crew.filter((m) => m.role === role).length;
    if (count > (limit as number)) {
      throw new BadRequestException(`At most ${limit} ${role.toLowerCase()}(s) can be assigned`);
    }
  }

  if (ids.length === 0) return new Map<string, { id: string; name: string; role: UserRole }>();

  const users = await prisma.user.findMany({
    where: { id: { in: ids }, vendorId },
    select: { id: true, name: true, role: true, isActive: true },
  });
  const byId = new Map(users.map((u) => [u.id, u]));

  for (const member of crew) {
    const user = byId.get(member.userId);
    if (!user) throw new NotFoundException('Crew member not found');
    if (!user.isActive) {
      throw new BadRequestException(`${user.name} is deactivated and cannot be assigned to a crew`);
    }
    const allowed = ALLOWED_USER_ROLES[member.role] ?? [];
    if (!allowed.includes(user.role)) {
      throw new BadRequestException(
        `${user.name} (${user.role}) cannot be assigned as ${member.role}`,
      );
    }
  }

  return byId;
}
