import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { CacheInvalidationService, CACHE_KEYS } from '@water-supply-crm/caching';
import { AuditService } from '../audit/audit.service';
import { CreateCustomerGroupDto, UpdateCustomerGroupDto } from './dto/customer-group.dto';

@Injectable()
export class CustomerGroupService {
  constructor(
    private prisma: PrismaService,
    private cache: CacheInvalidationService,
    private audit: AuditService,
  ) {}

  async getSettings(vendorId: string) {
    const vendor = await this.prisma.vendor.findUnique({
      where: { id: vendorId },
      select: { customerGroupingEnabled: true },
    });
    return { enabled: vendor?.customerGroupingEnabled ?? false };
  }

  /** Turning it OFF only hides the feature; groups and customer assignments are kept. */
  async setEnabled(vendorId: string, enabled: boolean) {
    await this.prisma.vendor.update({ where: { id: vendorId }, data: { customerGroupingEnabled: enabled } });
    await this.cache.invalidateVendorEntity(vendorId, CACHE_KEYS.CUSTOMERS);
    await this.audit.log({
      vendorId,
      action: 'UPDATE',
      entity: 'Vendor',
      entityId: vendorId,
      changes: { after: { customerGroupingEnabled: enabled } },
    });
    return { enabled };
  }

  /** Groups with their sub-groups and live customer counts. Deleted rows are hidden unless asked for. */
  async list(vendorId: string, includeDeleted = false) {
    const deletedFilter = includeDeleted ? {} : { deletedAt: null };
    const groups = await this.prisma.customerGroup.findMany({
      where: { vendorId, parentId: null, ...deletedFilter },
      orderBy: { name: 'asc' },
      include: {
        _count: { select: { customersInGroup: true } },
        children: {
          where: deletedFilter,
          orderBy: { name: 'asc' },
          include: { _count: { select: { customersInSubGroup: true } } },
        },
      },
    });
    return groups.map((g) => ({
      id: g.id,
      name: g.name,
      deletedAt: g.deletedAt,
      customerCount: g._count.customersInGroup,
      subGroups: g.children.map((c) => ({
        id: c.id,
        name: c.name,
        parentId: c.parentId,
        deletedAt: c.deletedAt,
        customerCount: c._count.customersInSubGroup,
      })),
    }));
  }

  async create(vendorId: string, dto: CreateCustomerGroupDto) {
    const settings = await this.getSettings(vendorId);
    if (!settings.enabled) throw new BadRequestException('Customer grouping is not enabled for this vendor');

    if (dto.parentId) {
      const parent = await this.prisma.customerGroup.findFirst({
        where: { id: dto.parentId, vendorId, parentId: null, deletedAt: null },
      });
      if (!parent) throw new NotFoundException('Parent group not found');
    }
    await this.assertNameFree(vendorId, dto.parentId ?? null, dto.name);

    const group = await this.prisma.customerGroup.create({
      data: { vendorId, name: dto.name, parentId: dto.parentId ?? null },
    });
    await this.audit.log({
      vendorId,
      action: 'CREATE',
      entity: 'CustomerGroup',
      entityId: group.id,
      changes: { after: { name: group.name, parentId: group.parentId } },
    });
    return group;
  }

  async rename(vendorId: string, id: string, dto: UpdateCustomerGroupDto) {
    const group = await this.findActive(vendorId, id);
    await this.assertNameFree(vendorId, group.parentId, dto.name, id);
    const updated = await this.prisma.customerGroup.update({ where: { id }, data: { name: dto.name } });
    // Customer lists embed the group name, so drop the cached pages.
    await this.cache.invalidateVendorEntity(vendorId, CACHE_KEYS.CUSTOMERS);
    await this.audit.log({
      vendorId,
      action: 'UPDATE',
      entity: 'CustomerGroup',
      entityId: id,
      changes: { before: { name: group.name }, after: { name: updated.name } },
    });
    return updated;
  }

  /**
   * Blocked while any customer is assigned (groupId is always set when subGroupId is, so counting
   * groupId covers sub-group members too). Otherwise soft-deleted (voided) so history can still
   * be filtered by it; a deleted Group takes its (necessarily empty) sub-groups with it.
   */
  async remove(vendorId: string, id: string) {
    const group = await this.findActive(vendorId, id);
    const assigned = await this.prisma.customer.count({
      where: group.parentId ? { vendorId, subGroupId: id } : { vendorId, groupId: id },
    });
    if (assigned > 0) {
      throw new ConflictException(
        `Cannot delete: ${assigned} customer${assigned === 1 ? ' is' : 's are'} still assigned. Reassign them first.`,
      );
    }
    await this.prisma.customerGroup.updateMany({
      where: { vendorId, deletedAt: null, OR: [{ id }, { parentId: id }] },
      data: { deletedAt: new Date() },
    });
    await this.audit.log({ vendorId, action: 'DELETE', entity: 'CustomerGroup', entityId: id });
    return { success: true };
  }

  private async findActive(vendorId: string, id: string) {
    const group = await this.prisma.customerGroup.findFirst({ where: { id, vendorId, deletedAt: null } });
    if (!group) throw new NotFoundException('Group not found');
    return group;
  }

  private async assertNameFree(vendorId: string, parentId: string | null, name: string, excludeId?: string) {
    const clash = await this.prisma.customerGroup.findFirst({
      where: {
        vendorId,
        parentId,
        deletedAt: null,
        name: { equals: name, mode: 'insensitive' },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });
    if (clash) throw new ConflictException(`A ${parentId ? 'sub-group' : 'group'} named "${name}" already exists`);
  }
}
