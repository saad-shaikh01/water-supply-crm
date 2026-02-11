import { Injectable } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { CreateVanDto } from './dto/create-van.dto';

@Injectable()
export class VanService {
  constructor(private prisma: PrismaService) {}

  async create(vendorId: string, createVanDto: CreateVanDto) {
    return this.prisma.van.create({
      data: {
        ...createVanDto,
        vendorId,
      },
    });
  }

  async findAll(vendorId: string) {
    return this.prisma.van.findMany({
      where: { vendorId },
      include: { defaultDriver: true },
    });
  }
}
