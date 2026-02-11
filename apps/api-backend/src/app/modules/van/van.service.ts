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

@Injectable()
export class VanService {
  constructor(
    private prisma: PrismaService,
    private cache: CacheInvalidationService,
  ) {}

  async create(vendorId: string, dto: CreateVanDto) {
    const van = await this.prisma.van.create({
      data: { ...dto, vendorId },
    });
    await this.cache.invalidateVendorEntity(vendorId, CACHE_KEYS.VANS);
    return van;
  }

  async findAll(vendorId: string) {
    const cacheKey = this.cache.vendorKey(vendorId, CACHE_KEYS.VANS);
    const cached = await this.cache.get(cacheKey);
    if (cached) return cached;

    const vans = await this.prisma.van.findMany({
      where: { vendorId },
      include: { defaultDriver: { select: { id: true, name: true, email: true } } },
    });
    await this.cache.set(cacheKey, vans, CACHE_TTLS.VANS);
    return vans;
  }

  async findOne(vendorId: string, id: string) {
    const van = await this.prisma.van.findFirst({
      where: { id, vendorId },
      include: { defaultDriver: { select: { id: true, name: true, email: true } } },
    });
    if (!van) {
      throw new NotFoundException('Van not found');
    }
    return van;
  }

  async update(vendorId: string, id: string, dto: UpdateVanDto) {
    const van = await this.prisma.van.findFirst({
      where: { id, vendorId },
    });
    if (!van) {
      throw new NotFoundException('Van not found');
    }

    const updated = await this.prisma.van.update({
      where: { id },
      data: dto,
      include: { defaultDriver: { select: { id: true, name: true, email: true } } },
    });
    await this.cache.invalidateVendorEntity(vendorId, CACHE_KEYS.VANS);
    return updated;
  }

  async remove(vendorId: string, id: string) {
    const van = await this.prisma.van.findFirst({
      where: { id, vendorId },
      include: {
        _count: {
          select: { dailySheets: { where: { isClosed: false } } },
        },
      },
    });
    if (!van) {
      throw new NotFoundException('Van not found');
    }
    if (van._count.dailySheets > 0) {
      throw new ConflictException(
        'Cannot delete van with open daily sheets. Close all sheets first.',
      );
    }

    await this.prisma.van.delete({ where: { id } });
    await this.cache.invalidateVendorEntity(vendorId, CACHE_KEYS.VANS);
    return { deleted: true };
  }
}
