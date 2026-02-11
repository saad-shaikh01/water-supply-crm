import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { CreateVendorDto } from './dto/create-vendor.dto';
import { UpdateVendorDto } from './dto/update-vendor.dto';
import { UserService } from '../user/user.service';
import { UserRole } from '@prisma/client';

@Injectable()
export class VendorService {
  constructor(
    private prisma: PrismaService,
    private userService: UserService,
  ) {}

  async create(createVendorDto: CreateVendorDto) {
    const { adminEmail, adminPassword, adminName, ...vendorData } =
      createVendorDto;

    const existing = await this.prisma.vendor.findUnique({
      where: { slug: vendorData.slug },
    });

    if (existing) {
      throw new ConflictException('Vendor with this slug already exists');
    }

    return this.prisma.$transaction(async (tx) => {
      const vendor = await tx.vendor.create({
        data: vendorData,
      });

      await this.userService.create({
        email: adminEmail,
        password: adminPassword,
        name: adminName,
        role: UserRole.VENDOR_ADMIN,
        vendorId: vendor.id,
      });

      return vendor;
    });
  }

  async findAll() {
    return this.prisma.vendor.findMany();
  }

  async findOne(id: string) {
    const vendor = await this.prisma.vendor.findUnique({
      where: { id },
    });
    if (!vendor) {
      throw new NotFoundException('Vendor not found');
    }
    return vendor;
  }

  async update(id: string, dto: UpdateVendorDto) {
    const vendor = await this.prisma.vendor.findUnique({ where: { id } });
    if (!vendor) {
      throw new NotFoundException('Vendor not found');
    }
    return this.prisma.vendor.update({
      where: { id },
      data: dto,
    });
  }
}
