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
import { paginate } from '../../common/helpers/paginate';

@Injectable()
export class RouteService {
  constructor(
    private prisma: PrismaService,
    private cache: CacheInvalidationService,
  ) {}

  async create(vendorId: string, dto: CreateRouteDto) {
    if (dto.defaultVanId) {
      const van = await this.prisma.van.findFirst({ where: { id: dto.defaultVanId, vendorId } });
      if (!van) throw new NotFoundException('Van not found');
    }

    const route = await this.prisma.route.create({
      data: { ...dto, vendorId },
      include: {
        defaultVan: { include: { defaultDriver: { select: { id: true, name: true } } } },
      },
    });
    await this.cache.invalidateVendorEntity(vendorId, CACHE_KEYS.ROUTES);
    return route;
  }

  async findAllPaginated(vendorId: string, query: any) {
    const { page = 1, limit = 20, search, defaultVanId } = query;

    const where: any = { vendorId };
    if (search) {
      where.name = { contains: search, mode: 'insensitive' };
    }
    if (defaultVanId) {
      where.defaultVanId = defaultVanId;
    }

    const hasFilters = !!(search || defaultVanId);
    const cacheKey = this.cache.vendorKey(
      vendorId,
      `${CACHE_KEYS.ROUTES}:p:${page}:l:${limit}:s:${search || ''}:v:${defaultVanId || ''}`,
    );

    if (!hasFilters) {
      const cached = await this.cache.get(cacheKey);
      if (cached) return cached;
    }

    const [data, total] = await Promise.all([
      this.prisma.route.findMany({
        where,
        include: {
          _count: { select: { customers: true } },
          defaultVan: {
            select: {
              id: true,
              plateNumber: true,
              defaultDriver: { select: { id: true, name: true } },
            },
          },
        },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.route.count({ where }),
    ]);

    const result = paginate(data, total, page, limit);
    if (!hasFilters) {
      await this.cache.set(cacheKey, result, CACHE_TTLS.ROUTES);
    }
    return result;
  }

  async findOne(vendorId: string, id: string) {
    const route = await this.prisma.route.findFirst({
      where: { id, vendorId },
      include: {
        _count: { select: { customers: true } },
        defaultVan: {
          select: {
            id: true,
            plateNumber: true,
            defaultDriver: { select: { id: true, name: true } },
          },
        },
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
    const route = await this.prisma.route.findFirst({ where: { id, vendorId } });
    if (!route) throw new NotFoundException('Route not found');

    if (dto.defaultVanId) {
      const van = await this.prisma.van.findFirst({ where: { id: dto.defaultVanId, vendorId } });
      if (!van) throw new NotFoundException('Van not found');
    }

    const updated = await this.prisma.route.update({
      where: { id },
      data: dto,
      include: {
        defaultVan: {
          select: {
            id: true,
            plateNumber: true,
            defaultDriver: { select: { id: true, name: true } },
          },
        },
      },
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
