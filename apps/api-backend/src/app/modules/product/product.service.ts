import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import {
  CacheInvalidationService,
  CACHE_KEYS,
  CACHE_TTLS,
} from '@water-supply-crm/caching';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

@Injectable()
export class ProductService {
  constructor(
    private prisma: PrismaService,
    private cache: CacheInvalidationService,
  ) {}

  async create(vendorId: string, dto: CreateProductDto) {
    const product = await this.prisma.product.create({
      data: { ...dto, vendorId },
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
