import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import type { AuthUser } from '@water-supply-crm/types';
import { AuditService } from '../audit/audit.service';
import { CacheInvalidationService, CACHE_KEYS } from '@water-supply-crm/caching';
import { ApplyCustomerFlagDto } from './dto/apply-customer-flag.dto';
import { ResolveCustomerFlagDto } from './dto/resolve-customer-flag.dto';

/**
 * Applying / resolving a `CustomerFlag` — the highlight instance on a
 * specific customer (see the schema comment on `CustomerFlag`). A flag is
 * never deleted: removing the highlight is `resolve`, which flips it to
 * `RESOLVED` with a mandatory-in-spirit reason and keeps it queryable as
 * history, same "never edit/delete, reverse instead" convention as
 * `CustomerFinancialAdjustment`'s void.
 */
@Injectable()
export class CustomerFlagService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly cache: CacheInvalidationService,
  ) {}

  async apply(user: AuthUser, customerId: string, dto: ApplyCustomerFlagDto) {
    const customer = await this.prisma.customer.findFirst({ where: { id: customerId, vendorId: user.vendorId } });
    if (!customer) throw new NotFoundException('Customer not found');

    const category = await this.prisma.customerFlagCategory.findFirst({
      where: { id: dto.categoryId, vendorId: user.vendorId, isActive: true },
    });
    if (!category) throw new BadRequestException('Unknown or inactive flag category');

    const existing = await this.prisma.customerFlag.findFirst({
      where: { customerId, categoryId: dto.categoryId, status: 'OPEN' },
    });
    if (existing) {
      throw new ConflictException(`${customer.name} already has an active "${category.name}" flag`);
    }

    const message = (dto.message?.trim() || category.defaultMessage?.trim() || '').trim();
    if (!message) {
      throw new BadRequestException('A message is required — set one on the category or the flag itself');
    }

    const created = await this.prisma.customerFlag.create({
      data: {
        vendorId: user.vendorId,
        customerId,
        categoryId: dto.categoryId,
        message,
        createdById: user.userId,
        createdByName: user.name,
      },
      include: { category: true },
    });

    await this.cache.invalidateVendorEntity(user.vendorId, CACHE_KEYS.CUSTOMERS);

    await this.audit.log({
      vendorId: user.vendorId,
      userId: user.userId,
      userName: user.name,
      action: 'FLAGGED',
      entity: 'CustomerFlag',
      entityId: created.id,
      changes: { after: { customerId, customerName: customer.name, category: category.name, message } },
    });

    return created;
  }

  async resolve(user: AuthUser, customerId: string, flagId: string, dto: ResolveCustomerFlagDto) {
    const flag = await this.prisma.customerFlag.findFirst({
      where: { id: flagId, customerId, vendorId: user.vendorId },
      include: { category: true, customer: { select: { name: true } } },
    });
    if (!flag) throw new NotFoundException('Flag not found');
    if (flag.status === 'RESOLVED') throw new ConflictException('This flag was already resolved');

    const resolved = await this.prisma.customerFlag.update({
      where: { id: flagId },
      data: {
        status: 'RESOLVED',
        resolvedById: user.userId,
        resolvedByName: user.name,
        resolvedAt: new Date(),
        resolvedReason: dto.resolvedReason?.trim() || null,
      },
      include: { category: true },
    });

    await this.cache.invalidateVendorEntity(user.vendorId, CACHE_KEYS.CUSTOMERS);

    await this.audit.log({
      vendorId: user.vendorId,
      userId: user.userId,
      userName: user.name,
      action: 'RESOLVED',
      entity: 'CustomerFlag',
      entityId: flag.id,
      changes: {
        before: { status: 'OPEN' },
        after: { status: 'RESOLVED', resolvedReason: resolved.resolvedReason },
        reason: dto.resolvedReason,
      },
    });

    return resolved;
  }

  /** Full flag history (open + resolved) for one customer, newest first. */
  async history(vendorId: string, customerId: string) {
    return this.prisma.customerFlag.findMany({
      where: { vendorId, customerId },
      include: { category: true },
      orderBy: { createdAt: 'desc' },
    });
  }
}
