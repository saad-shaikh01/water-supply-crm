import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import {
  CacheInvalidationService,
  CACHE_KEYS,
  CACHE_TTLS,
} from '@water-supply-crm/caching';
import { CreateRouteDto } from './dto/create-route.dto';
import { UpdateRouteDto } from './dto/update-route.dto';

@Injectable()
export class RouteService {
  constructor(
    private prisma: PrismaService,
    private cache: CacheInvalidationService,
  ) {}

  async create(vendorId: string, dto: CreateRouteDto) {
    const route = await this.prisma.route.create({
      data: { ...dto, vendorId },
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

  async findOne(vendorId: string, id: string) {
    const route = await this.prisma.route.findFirst({
      where: { id, vendorId },
      include: {
        _count: { select: { customers: true } },
        customers: {
          select: { id: true, name: true, customerCode: true, address: true },
        },
      },
    });
    if (!route) {
      throw new NotFoundException('Route not found');
    }
    return route;
  }

  async update(vendorId: string, id: string, dto: UpdateRouteDto) {
    const route = await this.prisma.route.findFirst({
      where: { id, vendorId },
    });
    if (!route) {
      throw new NotFoundException('Route not found');
    }

    const updated = await this.prisma.route.update({
      where: { id },
      data: dto,
    });
    await this.cache.invalidateVendorEntity(vendorId, CACHE_KEYS.ROUTES);
    return updated;
  }

  async remove(vendorId: string, id: string) {
    const route = await this.prisma.route.findFirst({
      where: { id, vendorId },
      include: { _count: { select: { customers: true } } },
    });
    if (!route) {
      throw new NotFoundException('Route not found');
    }
    if (route._count.customers > 0) {
      throw new ConflictException(
        'Cannot delete route with assigned customers. Reassign customers first.',
      );
    }

    await this.prisma.route.delete({ where: { id } });
    await this.cache.invalidateVendorEntity(vendorId, CACHE_KEYS.ROUTES);
    return { deleted: true };
  }
}
