import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '@water-supply-crm/database';
import {
  createMockCustomer,
  createPrismaProvider,
  createTestModule,
  mockPrismaTransaction,
  prismaMock,
} from './index';

@Injectable()
class TestCustomerLookupService {
  constructor(private readonly prisma: PrismaService) {}

  async findCustomer(userId: string) {
    return (this.prisma as unknown as PrismaClient).customer.findFirst({
      where: { userId },
    });
  }

  async findCustomerInTransaction(userId: string) {
    return (this.prisma as unknown as PrismaClient).$transaction((tx) =>
      tx.customer.findFirst({ where: { userId } }),
    );
  }
}

describe('shared backend test foundation', () => {
  let service: TestCustomerLookupService;

  beforeEach(async () => {
    mockPrismaTransaction();

    const module = await createTestModule({
      providers: [TestCustomerLookupService, createPrismaProvider()],
    });

    service = module.get(TestCustomerLookupService);
  });

  it('provides a reusable PrismaService deep mock through Nest DI', async () => {
    const customer = createMockCustomer({ userId: 'user-test-001' });
    prismaMock.customer.findFirst.mockResolvedValue(customer);

    await expect(service.findCustomer('user-test-001')).resolves.toEqual(customer);
    expect(prismaMock.customer.findFirst).toHaveBeenCalledWith({
      where: { userId: 'user-test-001' },
    });
  });

  it('supports callback-style prisma.$transaction without per-test boilerplate', async () => {
    const customer = createMockCustomer({ userId: 'user-test-002' });
    prismaMock.customer.findFirst.mockResolvedValue(customer);

    await expect(
      service.findCustomerInTransaction('user-test-002'),
    ).resolves.toEqual(customer);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });
});
