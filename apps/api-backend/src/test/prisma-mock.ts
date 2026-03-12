import { PrismaClient } from '@prisma/client';
import { DeepMockProxy, mockDeep, mockReset } from 'jest-mock-extended';

export type PrismaMock = DeepMockProxy<PrismaClient>;

export function createPrismaMock(): PrismaMock {
  return mockDeep<PrismaClient>();
}

export const prismaMock = createPrismaMock();

export function resetPrismaMock(mock: PrismaMock = prismaMock): PrismaMock {
  mockReset(mock);
  return mock;
}

export function mockPrismaTransaction(
  mock: PrismaMock = prismaMock,
  tx: unknown = mock,
): PrismaMock {
  mock.$transaction.mockImplementation(async (arg: unknown) => {
    if (typeof arg === 'function') {
      return (arg as (client: unknown) => unknown)(tx);
    }

    return Promise.all(arg as Promise<unknown>[]);
  });

  return mock;
}

beforeEach(() => {
  resetPrismaMock();
  mockPrismaTransaction();
});
