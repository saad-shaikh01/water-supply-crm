import { Injectable } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { CacheInvalidationService, CACHE_KEYS, CACHE_TTLS } from '@water-supply-crm/caching';
import { CreateRouteDto } from './dto/create-route.dto';

@Injectable()
export class RouteService {
  constructor(
    private prisma: PrismaService,
    private cache: CacheInvalidationService,
  ) {}

  async create(vendorId: string, createRouteDto: CreateRouteDto) {
    const route = await this.prisma.route.create({
      data: {
        ...createRouteDto,
        vendorId,
      },
    });
    await this.cache.invalidateVendorEntity(vendorId, CACHE_KEYS.ROUTES);
    return route;
  }

  async findAll(vendorId: string) {
    const cacheKey = this.cache.vendorKey(vendorId, CACHE_KEYS.ROUTES);
    const cached = await this.cache.get(cacheKey);
    if (cached) return cached;

    const routes = await this.prisma.route.findMany({
      where: { vendorId },
      include: { _count: { select: { customers: true } } },
    });
    await this.cache.set(cacheKey, routes, CACHE_TTLS.ROUTES);
    return routes;
  }
}
