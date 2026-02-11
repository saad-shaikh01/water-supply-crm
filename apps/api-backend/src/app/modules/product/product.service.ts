import { Injectable } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { CacheInvalidationService, CACHE_KEYS, CACHE_TTLS } from '@water-supply-crm/caching';
import { CreateProductDto } from './dto/create-product.dto';

@Injectable()
export class ProductService {
  constructor(
    private prisma: PrismaService,
    private cache: CacheInvalidationService,
  ) {}

  async create(vendorId: string, createProductDto: CreateProductDto) {
    const product = await this.prisma.product.create({
      data: {
        ...createProductDto,
        vendorId,
      },
    });
    await this.cache.invalidateVendorEntity(vendorId, CACHE_KEYS.PRODUCTS);
    return product;
  }

  async findAll(vendorId: string) {
    const cacheKey = this.cache.vendorKey(vendorId, CACHE_KEYS.PRODUCTS);
    const cached = await this.cache.get(cacheKey);
    if (cached) return cached;

    const products = await this.prisma.product.findMany({
      where: { vendorId, isActive: true },
    });
    await this.cache.set(cacheKey, products, CACHE_TTLS.PRODUCTS);
    return products;
  }

  async findOne(vendorId: string, id: string) {
    return this.prisma.product.findFirst({
      where: { id, vendorId },
    });
  }
}
