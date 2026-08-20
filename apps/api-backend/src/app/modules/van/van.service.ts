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
import { CreateVanDto } from './dto/create-van.dto';
import { UpdateVanDto } from './dto/update-van.dto';
import { UpdateDefaultCrewDto } from './dto/update-default-crew.dto';
import { paginate } from '../../common/helpers/paginate';
import { validateSupportCrew, validateDriverAssignment } from '../../common/helpers/crew-validation';

@Injectable()
export class VanService {
  constructor(
    private prisma: PrismaService,
    private cache: CacheInvalidationService,
  ) {}

  async create(vendorId: string, dto: CreateVanDto) {
    if (dto.defaultDriverId) {
      await validateDriverAssignment(this.prisma, vendorId, dto.defaultDriverId);
    }
    const van = await this.prisma.van.create({
      data: { ...dto, vendorId },
    });
    await this.cache.invalidateVendorEntity(vendorId, CACHE_KEYS.VANS);
    return van;
  }

  private vanInclude = {
    defaultDriver: { select: { id: true, name: true, email: true } },
    routes: { select: { id: true, name: true } },
    defaultCrew: {
      include: { user: { select: { id: true, name: true, role: true, isActive: true } } },
      orderBy: { createdAt: 'asc' as const },
    },
  };

  async findAllPaginated(vendorId: string, query: any) {
    const { page = 1, limit = 20, isActive } = query;
    const cacheKey = this.cache.vendorKey(vendorId, `${CACHE_KEYS.VANS}:p:${page}:l:${limit}:a:${isActive}`);
    const cached = await this.cache.get(cacheKey);
    if (cached) return cached;

    const where: any = { vendorId };
    if (isActive !== undefined) where.isActive = isActive === 'true' || isActive === true;

    const [data, total] = await Promise.all([
      this.prisma.van.findMany({
        where,
        include: this.vanInclude,
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.van.count({ where }),
    ]);

    const result = paginate(data, total, page, limit);
    await this.cache.set(cacheKey, result, CACHE_TTLS.VANS);
    return result;
  }

  async findAll(vendorId: string) {
    return this.prisma.van.findMany({
      where: { vendorId, isActive: true },
      include: this.vanInclude,
    });
  }

  async findOne(vendorId: string, id: string) {
    const van = await this.prisma.van.findFirst({
      where: { id, vendorId },
      include: this.vanInclude,
    });
    if (!van) throw new NotFoundException('Van not found');
    return van;
  }

  async deactivate(vendorId: string, id: string) {
    const van = await this.prisma.van.findFirst({ where: { id, vendorId } });
    if (!van) throw new NotFoundException('Van not found');

    const openSheets = await this.prisma.dailySheet.count({
      where: { vanId: id, isClosed: false },
    });
    if (openSheets > 0) {
      throw new ConflictException(
        `Van has ${openSheets} open daily sheet(s). Close them before deactivating.`
      );
    }

    const updated = await this.prisma.van.update({
      where: { id },
      data: { isActive: false },
      include: this.vanInclude,
    });
    await this.cache.invalidateVendorEntity(vendorId, CACHE_KEYS.VANS);
    return updated;
  }

  async reactivate(vendorId: string, id: string) {
    const van = await this.prisma.van.findFirst({ where: { id, vendorId } });
    if (!van) throw new NotFoundException('Van not found');

    const updated = await this.prisma.van.update({
      where: { id },
      data: { isActive: true },
      include: this.vanInclude,
    });
    await this.cache.invalidateVendorEntity(vendorId, CACHE_KEYS.VANS);
    return updated;
  }

  async update(vendorId: string, id: string, dto: UpdateVanDto) {
    const van = await this.prisma.van.findFirst({
      where: { id, vendorId },
    });
    if (!van) {
      throw new NotFoundException('Van not found');
    }
    if (dto.defaultDriverId) {
      await validateDriverAssignment(this.prisma, vendorId, dto.defaultDriverId);
    }

    const updated = await this.prisma.van.update({
      where: { id },
      data: dto,
      include: this.vanInclude,
    });
    await this.cache.invalidateVendorEntity(vendorId, CACHE_KEYS.VANS);
    return updated;
  }

  /** Full-replace the van's default supporting crew (salesman/loaders). */
  async updateDefaultCrew(vendorId: string, id: string, dto: UpdateDefaultCrewDto) {
    const van = await this.prisma.van.findFirst({ where: { id, vendorId } });
    if (!van) throw new NotFoundException('Van not found');

    await validateSupportCrew(this.prisma, vendorId, dto.crew, van.defaultDriverId);

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.vanDefaultCrew.deleteMany({ where: { vanId: id } });
      if (dto.crew.length > 0) {
        await tx.vanDefaultCrew.createMany({
          data: dto.crew.map((m) => ({ vanId: id, userId: m.userId, role: m.role })),
        });
      }
      return tx.van.findFirst({ where: { id }, include: this.vanInclude });
    });

    await this.cache.invalidateVendorEntity(vendorId, CACHE_KEYS.VANS);
    return updated;
  }

  async remove(vendorId: string, id: string) {
    const van = await this.prisma.van.findFirst({
      where: { id, vendorId },
      include: {
        _count: {
          select: { dailySheets: true },
        },
      },
    });
    if (!van) {
      throw new NotFoundException('Van not found');
    }
    if (van._count.dailySheets > 0) {
      throw new ConflictException(
        'Cannot delete van with delivery history. Deactivate it instead.',
      );
    }

    await this.prisma.van.delete({ where: { id } });
    await this.cache.invalidateVendorEntity(vendorId, CACHE_KEYS.VANS);
    return { deleted: true };
  }
}
