import { ModuleMetadata, Provider } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '@water-supply-crm/database';
import { PrismaMock, prismaMock } from './prisma-mock';

export async function createTestModule(
  metadata: ModuleMetadata,
): Promise<TestingModule> {
  return Test.createTestingModule(metadata).compile();
}

export function createPrismaProvider(
  mock: PrismaMock = prismaMock,
): Provider {
  return {
    provide: PrismaService,
    useValue: mock as unknown as PrismaService,
  };
}
