import { Injectable, ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { Prisma, UserRole } from '@prisma/client';
import { CacheInvalidationService } from '@water-supply-crm/caching';
import { CACHE_KEYS, CACHE_TTLS } from '@water-supply-crm/caching';
import * as bcrypt from 'bcrypt';
import { UpdateUserDto } from './dto/update-user.dto';
import { NO_LOGIN_ROLES } from './dto/create-user.dto';
import { UserQueryDto } from './dto/user-query.dto';
import { AuditService } from '../audit/audit.service';
import { PermissionService } from '../authz/permission.service';
import { AuthzPolicyService } from '../authz/authz-policy.service';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { paginate } from '../../common/helpers/paginate';
import { normalizePhone } from '../whatsapp/phone.util';

@Injectable()
export class UserService {
  constructor(
    private prisma: PrismaService,
    private cache: CacheInvalidationService,
    private audit: AuditService,
    private permissions: PermissionService,
    private policy: AuthzPolicyService,
  ) {}

  async create(data: {
    email?: string;
    password?: string;
    name: string;
    role: UserRole;
    vendorId?: string;
    phoneNumber?: string;
  }) {
    // Email/password may be omitted only for no-login field staff
    if (!NO_LOGIN_ROLES.includes(data.role)) {
      if (!data.email) throw new BadRequestException('Email is required for this role');
      if (!data.password) throw new BadRequestException('Password is required for this role');
    }

    if (data.email) {
      const existing = await this.prisma.user.findUnique({
        where: { email: data.email },
      });
      if (existing) {
        throw new ConflictException('User with this email already exists');
      }
    }

    const hashedPassword = data.password ? await bcrypt.hash(data.password, 10) : null;

    let user;
    try {
      user = await this.prisma.user.create({
        data: { ...data, email: data.email ?? null, password: hashedPassword },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('User with this email already exists');
      }
      throw e;
    }

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
      include: {
        vendor: { select: { id: true, name: true } },
        customer: { select: { id: true } },
      },
    });
  }

  async findByPhoneNumber(phoneNumber: string) {
    return this.prisma.user.findUnique({
      where: { phoneNumber },
      include: {
        vendor: { select: { id: true, name: true } },
        customer: { select: { id: true } },
      },
    });
  }

  async findByIdentifier(identifier: string) {
    const byEmail = await this.findByEmail(identifier);
    if (byEmail) return byEmail;

    const exact = await this.findByPhoneNumber(identifier);
    if (exact) return exact;

    // Fallback: retry with a normalized phone (e.g. "0300-1234567" → "923001234567")
    // so login tolerates common formatting differences. Only fires when the exact
    // match already failed, so it can't change the outcome of an existing successful login.
    const normalized = normalizePhone(identifier);
    if (normalized && normalized !== identifier) {
      return this.findByPhoneNumber(normalized);
    }
    return null;
  }

  async findById(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      include: {
        vendor: { select: { id: true, name: true } },
        customer: { select: { id: true } },
      },
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

    // Last-admin protection, concurrency-safe (check + write in one serializable txn).
    const updated = await this.prisma.$transaction(
      async (tx) => {
        await this.policy.assertNotLastAdmin(vendorId, id, tx as never);
        return tx.user.update({
          where: { id },
          data: { isActive: false },
          select: { id: true, email: true, name: true, role: true, isActive: true },
        });
      },
      { isolationLevel: 'Serializable' },
    );

    await this.cache.invalidateVendorEntity(vendorId, CACHE_KEYS.USERS);
    await this.permissions.invalidateUser(id); // clear cached effective permissions

    // Clear this driver from any van that still references them
    await this.prisma.van.updateMany({
      where: { defaultDriverId: id, vendorId },
      data: { defaultDriverId: null },
    });

    // Remove from any van's default crew template (past sheet crew snapshots stay)
    await this.prisma.vanDefaultCrew.deleteMany({
      where: { userId: id, van: { vendorId } },
    });

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
          select: { dailySheets: true, crewAssignments: true },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const [vanAssignment, activeDamages] = await Promise.all([
      this.prisma.van.findFirst({
        where: { defaultDriverId: id, vendorId },
        select: { plateNumber: true },
      }),
      this.prisma.damageCase.count({
        where: { driverId: id, status: { in: ['REPORTED', 'UNDER_REVIEW'] } },
      }),
    ]);
    if (vanAssignment) {
      throw new BadRequestException(
        `Driver is the default driver of van "${vanAssignment.plateNumber}". Reassign the van first.`
      );
    }
    if (activeDamages > 0) {
      throw new BadRequestException(
        `Driver has ${activeDamages} active damage case(s). Resolve them before deleting.`
      );
    }

    if (user._count.dailySheets > 0) {
      throw new BadRequestException(
        `Cannot delete user — they have ${user._count.dailySheets} daily sheet(s) on record. Deactivate instead to preserve history.`,
      );
    }
    if (user._count.crewAssignments > 0) {
      throw new BadRequestException(
        `Cannot delete user — they appear in the crew of ${user._count.crewAssignments} daily sheet(s). Deactivate instead to preserve history.`,
      );
    }

    // Default-crew template rows are just config — safe to remove with the user
    await this.prisma.vanDefaultCrew.deleteMany({ where: { userId: id } });

    // Last-admin protection, concurrency-safe (check + delete in one serializable txn).
    await this.prisma.$transaction(
      async (tx) => {
        await this.policy.assertNotLastAdmin(vendorId, id, tx as never);
        await tx.user.delete({ where: { id } });
      },
      { isolationLevel: 'Serializable' },
    );
    await this.cache.invalidateVendorEntity(vendorId, CACHE_KEYS.USERS);
    await this.permissions.invalidateUser(id); // clear cached effective permissions

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
    if (!user.password) throw new BadRequestException('This account has no password set');

    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) throw new BadRequestException('Current password is incorrect');

    const hashed = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({ where: { id: userId }, data: { password: hashed } });
    return { message: 'Password changed successfully' };
  }
}
