import { Injectable } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { CreateRouteDto } from './dto/create-route.dto';

@Injectable()
export class RouteService {
  constructor(private prisma: PrismaService) {}

  async create(vendorId: string, createRouteDto: CreateRouteDto) {
    return this.prisma.route.create({
      data: {
        ...createRouteDto,
        vendorId,
      },
    });
  }

  async findAll(vendorId: string) {
    return this.prisma.route.findMany({
      where: { vendorId },
      include: { _count: { select: { customers: true } } },
    });
  }
}
