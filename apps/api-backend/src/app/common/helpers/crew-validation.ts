import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CrewRole, UserRole } from '@prisma/client';
import { PrismaService } from '@water-supply-crm/database';

export interface CrewMemberInput {
  userId: string;
  role: CrewRole;
}

// DRIVER/SALESMAN/LOADER are treated as one interchangeable field-staff pool
// — the same person may drive one day and load the next, so every crew role
// accepts a user whose home UserRole is any of the three (previously this
// only allowed "downgrades" — a spare driver could ride as salesman/loader,
// but not the reverse). Mirrors CREW_ROLE_ELIGIBLE in the frontend's
// crew-editor.tsx — keep both in sync.
const FIELD_STAFF_ROLES: UserRole[] = [UserRole.DRIVER, UserRole.SALESMAN, UserRole.LOADER];
const ALLOWED_USER_ROLES: Partial<Record<CrewRole, UserRole[]>> = {
  [CrewRole.SALESMAN]: FIELD_STAFF_ROLES,
  [CrewRole.LOADER]: FIELD_STAFF_ROLES,
};

/**
 * Validates a supporting-crew list (salesman/loaders — never the driver):
 * duplicates, per-role limits, tenancy, active status, and role compatibility.
 * `excludeUserId` is the sheet/van's day driver (or drivers — e.g. a van's
 * defaultDriverId and defaultSalesmanId are both excluded even though only
 * one of them ends up as the actual driver, see resolveEffectiveDriverId);
 * they cannot also be crew.
 * Returns the validated users keyed by id (for audit logging / responses).
 */
export async function validateSupportCrew(
  prisma: PrismaService,
  vendorId: string,
  crew: CrewMemberInput[],
  excludeUserId?: string | (string | null | undefined)[] | null,
) {
  if (crew.some((m) => m.role === CrewRole.DRIVER)) {
    throw new BadRequestException('The driver is assigned separately and cannot be part of the supporting crew');
  }

  const excludeIds = new Set(
    (Array.isArray(excludeUserId) ? excludeUserId : [excludeUserId]).filter(
      (id): id is string => !!id,
    ),
  );

  const ids = crew.map((m) => m.userId);
  if (new Set(ids).size !== ids.length) {
    throw new BadRequestException('The same person cannot appear in the crew twice');
  }
  if (ids.some((id) => excludeIds.has(id))) {
    throw new BadRequestException('The driver cannot also be assigned as supporting crew');
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

async function validateFieldStaffAssignment(
  prisma: PrismaService,
  vendorId: string,
  userId: string,
  label: string,
) {
  const user = await prisma.user.findFirst({
    where: { id: userId, vendorId },
    select: { id: true, name: true, role: true, isActive: true },
  });
  if (!user) throw new NotFoundException(`${label} not found`);
  if (!user.isActive) {
    throw new BadRequestException(`${user.name} is deactivated and cannot be assigned as ${label.toLowerCase()}`);
  }
  if (!FIELD_STAFF_ROLES.includes(user.role)) {
    throw new BadRequestException(`${user.name} (${user.role}) cannot be assigned as ${label.toLowerCase()}`);
  }
  return user;
}

/**
 * Validates a "driver for the day" assignment — Van.defaultDriverId
 * (van.service.ts create/update) and DailySheet.driverId (swapAssignment).
 * Same field-staff pool as validateSupportCrew's ALLOWED_USER_ROLES (any
 * DRIVER/SALESMAN/LOADER-role user may be the driver), plus tenancy +
 * active-status checks that this assignment previously had none of at all.
 */
export async function validateDriverAssignment(
  prisma: PrismaService,
  vendorId: string,
  driverId: string,
) {
  return validateFieldStaffAssignment(prisma, vendorId, driverId, 'Driver');
}

/**
 * Validates Van.defaultSalesmanId (van.service.ts create/update) — the
 * priority slot checked ahead of defaultDriverId when resolving who becomes
 * a generated sheet's driver (see resolveEffectiveDriverId). Same
 * field-staff pool as validateDriverAssignment.
 */
export async function validateSalesmanAssignment(
  prisma: PrismaService,
  vendorId: string,
  salesmanId: string,
) {
  return validateFieldStaffAssignment(prisma, vendorId, salesmanId, 'Salesman');
}

/**
 * Resolves who actually drives a van today: the default salesman if one is
 * assigned (owner decision — salesman takes priority over driver), else the
 * default driver, else null (sheet generation must skip the van). Shared by
 * daily-sheet generation, ensureSheetForVanDate, and swapAssignment's
 * van-change auto-fill so all three code paths agree.
 */
export function resolveEffectiveDriverId(van: {
  defaultDriverId: string | null;
  defaultSalesmanId?: string | null;
}): string | null {
  return van.defaultSalesmanId ?? van.defaultDriverId ?? null;
}
