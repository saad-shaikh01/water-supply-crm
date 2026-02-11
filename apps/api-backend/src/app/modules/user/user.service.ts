import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { UserRole } from '@prisma/client';
import { CacheInvalidationService } from '@water-supply-crm/caching';
import { CACHE_KEYS, CACHE_TTLS } from '@water-supply-crm/caching';
import * as bcrypt from 'bcrypt';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UserService {
  constructor(
    private prisma: PrismaService,
    private cache: CacheInvalidationService,
  ) {}

  async create(data: {
    email: string;
    password: string;
    name: string;
    role: UserRole;
    vendorId?: string;
    phoneNumber?: string;
  }) {
    const existing = await this.prisma.user.findUnique({
      where: { email: data.email },
    });

    if (existing) {
      throw new ConflictException('User with this email already exists');
    }

    const hashedPassword = await bcrypt.hash(data.password, 10);

    const user = await this.prisma.user.create({
      data: {
        ...data,
        password: hashedPassword,
      },
    });

    if (data.vendorId) {
      await this.cache.invalidateVendorEntity(data.vendorId, CACHE_KEYS.USERS);
    }

    const { password, ...result } = user;
    return result;
  }

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { email },
      include: { vendor: true },
    });
  }

  async findById(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      include: { vendor: true },
    });
  }

  async findAllByVendor(vendorId: string) {
    const cacheKey = this.cache.vendorKey(vendorId, CACHE_KEYS.USERS);
    const cached = await this.cache.get<any[]>(cacheKey);
    if (cached) return cached;

    const users = await this.prisma.user.findMany({
      where: { vendorId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        phoneNumber: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    await this.cache.set(cacheKey, users, CACHE_TTLS.USERS);
    return users;
  }

  async findOneByVendor(vendorId: string, id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, vendorId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        phoneNumber: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async update(vendorId: string, id: string, dto: UpdateUserDto) {
    const user = await this.prisma.user.findFirst({
      where: { id, vendorId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const updateData: any = { ...dto };
    if (dto.password) {
      updateData.password = await bcrypt.hash(dto.password, 10);
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        phoneNumber: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    await this.cache.invalidateVendorEntity(vendorId, CACHE_KEYS.USERS);
    return updated;
  }

  async deactivate(vendorId: string, id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, vendorId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: { isActive: false },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
      },
    });

    await this.cache.invalidateVendorEntity(vendorId, CACHE_KEYS.USERS);
    return updated;
  }

  async updatePassword(userId: string, hashedPassword: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });
  }
}
