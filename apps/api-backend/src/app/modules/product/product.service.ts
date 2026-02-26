import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import {
  CacheInvalidationService,
  CACHE_KEYS,
  CACHE_TTLS,
} from '@water-supply-crm/caching';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductQueryDto } from './dto/product-query.dto';
import { paginate } from '../../common/helpers/paginate';

@Injectable()
export class ProductService {
  constructor(
    private prisma: PrismaService,
    private cache: CacheInvalidationService,
  ) {}

  async create(vendorId: string, dto: CreateProductDto) {
    const product = await this.prisma.$transaction(async (tx) => {
      const created = await tx.product.create({ data: { ...dto, vendorId } });

      // Create a BottleWallet for every existing active customer of this vendor
      const customers = await tx.customer.findMany({
        where: { vendorId, isActive: true },
        select: { id: true },
      });

      if (customers.length > 0) {
        await tx.bottleWallet.createMany({
          data: customers.map((c) => ({
            customerId: c.id,
            productId: created.id,
            balance: 0,
          })),
          skipDuplicates: true,
        });
      }

      return created;
    });

    await this.cache.invalidateVendorEntity(vendorId, CACHE_KEYS.PRODUCTS);
    return product;
  }

  async findAll(vendorId: string, query: ProductQueryDto = {}) {
    const { page = 1, limit = 50, search, isActive, sortDir = 'asc' } = query;

    const where: any = { vendorId };

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (isActive !== undefined) {
      where.isActive = isActive;
    }

    const cacheKey = this.cache.vendorKey(vendorId, `${CACHE_KEYS.PRODUCTS}:p:${page}:l:${limit}:s:${search || ''}:a:${isActive}`);
    const cached = await this.cache.get(cacheKey);
    if (cached) return cached;

    const [data, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        orderBy: { name: sortDir },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.product.count({ where }),
    ]);

    const result = paginate(data, total, page, limit);
    await this.cache.set(cacheKey, result, CACHE_TTLS.PRODUCTS);
    return result;
  }

  async findOne(vendorId: string, id: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, vendorId },
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    return product;
  }

  async update(vendorId: string, id: string, dto: UpdateProductDto) {
    const product = await this.prisma.product.findFirst({
      where: { id, vendorId },
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    const updated = await this.prisma.product.update({
      where: { id },
      data: dto,
    });
    await this.cache.invalidateVendorEntity(vendorId, CACHE_KEYS.PRODUCTS);
    return updated;
  }

  async remove(vendorId: string, id: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, vendorId },
      include: {
        _count: { select: { sheetItems: true, orders: true } },
      },
    });
    if (!product) throw new NotFoundException('Product not found');
    if (product._count.sheetItems > 0 || product._count.orders > 0) {
      throw new ConflictException(
        'Cannot delete a product with existing delivery records or orders. Deactivate it instead.',
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.bottleWallet.deleteMany({ where: { productId: id } });
      await tx.customerProductPrice.deleteMany({ where: { productId: id } });
      await tx.product.delete({ where: { id } });
    });
    await this.cache.invalidateVendorEntity(vendorId, CACHE_KEYS.PRODUCTS);
    return { deleted: true };
  }

  async toggleActive(vendorId: string, id: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, vendorId },
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    const updated = await this.prisma.product.update({
      where: { id },
      data: { isActive: !product.isActive },
    });
    await this.cache.invalidateVendorEntity(vendorId, CACHE_KEYS.PRODUCTS);
    return updated;
  }
}
