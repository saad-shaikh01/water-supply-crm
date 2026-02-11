import { Injectable, ConflictException } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { CreateCustomerDto } from './dto/create-customer.dto';

@Injectable()
export class CustomerService {
  constructor(private prisma: PrismaService) {}

  async create(vendorId: string, createCustomerDto: CreateCustomerDto) {
    const existing = await this.prisma.customer.findUnique({
      where: { customerCode: createCustomerDto.customerCode },
    });

    if (existing) {
      throw new ConflictException('Customer code already exists');
    }

    return this.prisma.$transaction(async (tx) => {
      // 1. Create Customer
      const customer = await tx.customer.create({
        data: {
          ...createCustomerDto,
          vendorId,
        },
      });

      // 2. Initialize Wallets for all active products of this vendor
      const products = await tx.product.findMany({
        where: { vendorId, isActive: true },
      });

      for (const product of products) {
        await tx.bottleWallet.create({
          data: {
            customerId: customer.id,
            productId: product.id,
            balance: 0,
          },
        });
      }

      return customer;
    });
  }

  async findAll(vendorId: string) {
    return this.prisma.customer.findMany({
      where: { vendorId },
      include: { 
        route: true,
        wallets: { include: { product: true } }
      },
    });
  }
}
