import { Injectable } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { CreateProductDto } from './dto/create-product.dto';

@Injectable()
export class ProductService {
  constructor(private prisma: PrismaService) {}

  async create(vendorId: string, createProductDto: CreateProductDto) {
    return this.prisma.product.create({
      data: {
        ...createProductDto,
        vendorId,
      },
    });
  }

  async findAll(vendorId: string) {
    return this.prisma.product.findMany({
      where: { vendorId, isActive: true },
    });
  }

  async findOne(vendorId: string, id: string) {
    return this.prisma.product.findFirst({
      where: { id, vendorId },
    });
  }
}
