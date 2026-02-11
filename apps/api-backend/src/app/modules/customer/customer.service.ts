import {
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import {
  CacheInvalidationService,
  CACHE_KEYS,
  CACHE_TTLS,
} from '@water-supply-crm/caching';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { CustomerQueryDto } from './dto/customer-query.dto';
import { SetCustomPriceDto } from './dto/set-custom-price.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { paginate } from '../../common/helpers/paginate';

@Injectable()
export class CustomerService {
  constructor(
    private prisma: PrismaService,
    private cache: CacheInvalidationService,
  ) {}

  async create(vendorId: string, dto: CreateCustomerDto) {
    const existing = await this.prisma.customer.findUnique({
      where: { customerCode: dto.customerCode },
    });

    if (existing) {
      throw new ConflictException('Customer code already exists');
    }

    const customer = await this.prisma.$transaction(async (tx) => {
      const customer = await tx.customer.create({
        data: { ...dto, vendorId },
      });

      const products = await tx.product.findMany({
        where: { vendorId, isActive: true },
      });

      for (const product of products) {
        await tx.bottleWallet.create({
          data: {
            customerId: customer.id,
            productId: product.id,
            balance: 0,
          },
        });
      }

      return customer;
    });

    await this.cache.invalidateVendorEntity(vendorId, CACHE_KEYS.CUSTOMERS);
    return customer;
  }

  async findAllPaginated(vendorId: string, query: CustomerQueryDto) {
    const { page = 1, limit = 20, search, routeId, sort = 'name' } = query;

    const where: any = { vendorId };

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { customerCode: { contains: search, mode: 'insensitive' } },
        { phoneNumber: { contains: search } },
      ];
    }

    if (routeId) {
      where.routeId = routeId;
    }

    const [data, total] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        include: {
          route: { select: { id: true, name: true } },
          wallets: { include: { product: { select: { id: true, name: true } } } },
        },
        orderBy: { [sort]: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.customer.count({ where }),
    ]);

    return paginate(data, total, page, limit);
  }

  async findOne(vendorId: string, id: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id, vendorId },
      include: {
        route: true,
        wallets: { include: { product: true } },
        customPrices: { include: { product: true } },
      },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    return customer;
  }

  async update(vendorId: string, id: string, dto: UpdateCustomerDto) {
    const customer = await this.prisma.customer.findFirst({
      where: { id, vendorId },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    const updated = await this.prisma.customer.update({
      where: { id },
      data: dto,
      include: {
        route: { select: { id: true, name: true } },
        wallets: { include: { product: { select: { id: true, name: true } } } },
      },
    });

    await this.cache.invalidateVendorEntity(vendorId, CACHE_KEYS.CUSTOMERS);
    return updated;
  }

  async remove(vendorId: string, id: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id, vendorId },
      include: { _count: { select: { transactions: true } } },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    if (customer._count.transactions > 0) {
      throw new ConflictException(
        'Cannot delete customer with transaction history. Deactivate instead.',
      );
    }

    await this.prisma.customer.delete({ where: { id } });
    await this.cache.invalidateVendorEntity(vendorId, CACHE_KEYS.CUSTOMERS);
    return { deleted: true };
  }

  async setCustomPrice(vendorId: string, customerId: string, dto: SetCustomPriceDto) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, vendorId },
    });
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    const product = await this.prisma.product.findFirst({
      where: { id: dto.productId, vendorId },
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    const result = await this.prisma.customerProductPrice.upsert({
      where: {
        customerId_productId: {
          customerId,
          productId: dto.productId,
        },
      },
      create: {
        customerId,
        productId: dto.productId,
        price: dto.price,
      },
      update: {
        price: dto.price,
      },
      include: { product: true },
    });

    await this.cache.invalidateVendorEntity(vendorId, CACHE_KEYS.CUSTOMERS);
    return result;
  }

  async removeCustomPrice(vendorId: string, customerId: string, productId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, vendorId },
    });
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    await this.prisma.customerProductPrice.delete({
      where: {
        customerId_productId: {
          customerId,
          productId,
        },
      },
    });

    await this.cache.invalidateVendorEntity(vendorId, CACHE_KEYS.CUSTOMERS);
    return { deleted: true };
  }

  async getTransactionHistory(
    vendorId: string,
    customerId: string,
    pagination: PaginationQueryDto,
  ) {
    const { page = 1, limit = 20 } = pagination;

    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, vendorId },
    });
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    const where = { customerId, vendorId };

    const [data, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        include: {
          product: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.transaction.count({ where }),
    ]);

    return paginate(data, total, page, limit);
  }
}
