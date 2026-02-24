import { Injectable, ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { UserRole } from '@prisma/client';
import { CacheInvalidationService } from '@water-supply-crm/caching';
import { CACHE_KEYS, CACHE_TTLS } from '@water-supply-crm/caching';
import * as bcrypt from 'bcrypt';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserQueryDto } from './dto/user-query.dto';
import { AuditService } from '../audit/audit.service';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { paginate } from '../../common/helpers/paginate';

@Injectable()
export class UserService {
  constructor(
    private prisma: PrismaService,
    private cache: CacheInvalidationService,
    private audit: AuditService,
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

    await this.audit.log({
      vendorId: data.vendorId,
      action: 'CREATE',
      entity: 'User',
      entityId: user.id,
      changes: { after: { email: user.email, name: user.name, role: user.role } },
    });

    return result;
  }

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { email },
      include: { vendor: true, customer: true },
    });
  }

  async findByPhoneNumber(phoneNumber: string) {
    return this.prisma.user.findUnique({
      where: { phoneNumber },
      include: { vendor: true, customer: true },
    });
  }

  async findByIdentifier(identifier: string) {
    const byEmail = await this.findByEmail(identifier);
    if (byEmail) return byEmail;
    return this.findByPhoneNumber(identifier);
  }

  async findById(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      include: { vendor: true, customer: true },
    });
  }

  async findAllPaginated(vendorId: string, query: UserQueryDto) {
    const { page = 1, limit = 20, role, isActive } = query;
    const cacheKey = this.cache.vendorKey(vendorId, `${CACHE_KEYS.USERS}:p:${page}:l:${limit}:r:${role ?? ''}:a:${isActive ?? ''}`);
    const cached = await this.cache.get(cacheKey);
    if (cached) return cached;

    const where: any = { vendorId };
    if (role) where.role = role;
    if (isActive !== undefined) where.isActive = isActive;

    const [data, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
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
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.user.count({ where }),
    ]);

    const result = paginate(data, total, page, limit);
    await this.cache.set(cacheKey, result, CACHE_TTLS.USERS);
    return result;
  }

  async findAllByVendor(vendorId: string) {
    return this.prisma.user.findMany({
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

    await this.audit.log({
      vendorId,
      action: 'UPDATE',
      entity: 'User',
      entityId: id,
    });

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

    await this.audit.log({
      vendorId,
      action: 'DEACTIVATE',
      entity: 'User',
      entityId: id,
    });

    return updated;
  }

  async reactivate(vendorId: string, id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, vendorId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: { isActive: true },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
      },
    });

    await this.cache.invalidateVendorEntity(vendorId, CACHE_KEYS.USERS);

    await this.audit.log({
      vendorId,
      action: 'REACTIVATE',
      entity: 'User',
      entityId: id,
    });

    return updated;
  }

  async remove(vendorId: string, id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, vendorId },
      include: {
        _count: {
          select: { dailySheets: true },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user._count.dailySheets > 0) {
      throw new BadRequestException(
        `Cannot delete user — they have ${user._count.dailySheets} daily sheet(s) on record. Deactivate instead to preserve history.`,
      );
    }

    await this.prisma.user.delete({ where: { id } });
    await this.cache.invalidateVendorEntity(vendorId, CACHE_KEYS.USERS);

    await this.audit.log({
      vendorId,
      action: 'DELETE',
      entity: 'User',
      entityId: id,
      changes: { before: { email: user.email, name: user.name, role: user.role } },
    });

    return { message: 'User deleted successfully' };
  }

  async updatePassword(userId: string, hashedPassword: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });
  }

  async changeOwnPassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) throw new BadRequestException('Current password is incorrect');

    const hashed = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({ where: { id: userId }, data: { password: hashed } });
    return { message: 'Password changed successfully' };
  }
}
