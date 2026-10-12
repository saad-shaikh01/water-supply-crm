import { BadRequestException } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@prisma/client';

type Db = PrismaClient | Prisma.TransactionClient;

export interface ResolvedGrouping {
  groupId: string | null;
  subGroupId: string | null;
}

/**
 * Validates a (groupId, subGroupId) pair for a vendor and returns the pair to store.
 * Rules: vendor must have grouping enabled (unless clearing); a SubGroup needs its Group;
 * the SubGroup must belong to that Group; neither may be soft-deleted; both must be this vendor's.
 */
export async function resolveCustomerGrouping(
  db: Db,
  vendorId: string,
  groupId: string | null | undefined,
  subGroupId: string | null | undefined,
): Promise<ResolvedGrouping> {
  const group = groupId ?? null;
  const sub = subGroupId ?? null;
  if (!group && !sub) return { groupId: null, subGroupId: null };

  const vendor = await db.vendor.findUnique({ where: { id: vendorId }, select: { customerGroupingEnabled: true } });
  if (!vendor?.customerGroupingEnabled) {
    throw new BadRequestException('Customer grouping is not enabled for this vendor');
  }
  if (sub && !group) throw new BadRequestException('A sub-group requires a group');

  const groupRow = await db.customerGroup.findFirst({
    where: { id: group as string, vendorId, parentId: null, deletedAt: null },
    select: { id: true },
  });
  if (!groupRow) throw new BadRequestException('Group not found');

  if (sub) {
    const subRow = await db.customerGroup.findFirst({
      where: { id: sub, vendorId, parentId: group as string, deletedAt: null },
      select: { id: true },
    });
    if (!subRow) throw new BadRequestException('Sub-group not found under the selected group');
  }
  return { groupId: group, subGroupId: sub };
}
