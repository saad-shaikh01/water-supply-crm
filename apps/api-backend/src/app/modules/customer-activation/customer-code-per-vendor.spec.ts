import { ConflictException } from '@nestjs/common';
import { CustomerActivationService } from './customer-activation.service';
import { CustomerService } from '../customer/customer.service';

/**
 * Customer codes are unique PER VENDOR (audit finding C2): every vendor's first customer is `L1`.
 * The public portal-activation flow has no vendor context, so the phone number must disambiguate.
 */
function makeCache() {
  const store = new Map<string, unknown>();
  return {
    get: jest.fn(async (k: string) => store.get(k)),
    set: jest.fn(async (k: string, v: unknown) => void store.set(k, v)),
    del: jest.fn(async (k: string) => void store.delete(k)),
  };
}

const customer = (over: Record<string, unknown>) => ({
  id: 'c',
  customerCode: 'L1',
  vendorId: 'v',
  name: 'N',
  phoneNumber: '03001111111',
  isActive: true,
  userId: null,
  ...over,
});

function activation(customers: unknown[]) {
  const prisma = { customer: { findMany: jest.fn(async () => customers) } };
  const svc = new CustomerActivationService(prisma as never, makeCache() as never, {} as never, {} as never, {} as never);
  return { svc, prisma };
}

describe('portal activation with the same customer code at two vendors', () => {
  const l1A = customer({ id: 'cust-a', vendorId: 'vendor-a', name: 'Ali', phoneNumber: '03001111111' });
  const l1B = customer({ id: 'cust-b', vendorId: 'vendor-b', name: 'Bilal', phoneNumber: '03452222222' });

  it('resolves each customer by code + phone, even though both are L1', async () => {
    const { svc } = activation([l1A, l1B]);
    await expect(svc.checkEligibility({ customerCode: 'L1', phoneNumber: '03001111111' } as never)).resolves.toMatchObject({
      eligible: true,
      customerName: 'Ali',
    });
    await expect(svc.checkEligibility({ customerCode: 'L1', phoneNumber: '+92 345 2222222' } as never)).resolves.toMatchObject({
      eligible: true,
      customerName: 'Bilal',
    });
  });

  it('a phone that matches neither L1 is refused', async () => {
    const { svc } = activation([l1A, l1B]);
    const res = await svc.checkEligibility({ customerCode: 'L1', phoneNumber: '03009999999' } as never);
    expect(res.eligible).toBe(false);
    expect(res.reason).toMatch(/phone number does not match/i);
  });

  it('refuses (rather than guessing) when code AND phone match accounts at two vendors', async () => {
    const dup = customer({ id: 'cust-b2', vendorId: 'vendor-b', name: 'Dup', phoneNumber: '03001111111' });
    const { svc } = activation([l1A, dup]);
    const res = await svc.checkEligibility({ customerCode: 'L1', phoneNumber: '03001111111' } as never);
    expect(res.eligible).toBe(false);
    expect(res.reason).toMatch(/more than one account/i);
  });

  it('an unknown code is still "not found"', async () => {
    const { svc } = activation([]);
    const res = await svc.checkEligibility({ customerCode: 'L99', phoneNumber: '03001111111' } as never);
    expect(res.eligible).toBe(false);
    expect(res.reason).toMatch(/customer not found/i);
  });
});

describe('CustomerService.create — manual customerCode uniqueness is per vendor', () => {
  const dto = { customerCode: 'L1', name: 'N', phoneNumber: '03001111111', address: 'a' };

  it('only conflicts with the SAME vendor\'s L1 (compound lookup carries the vendorId)', async () => {
    const findUnique = jest.fn(async () => ({ id: 'existing' }));
    const svc = Object.create(CustomerService.prototype) as CustomerService;
    (svc as any).prisma = { customer: { findUnique } };

    await expect(svc.create('vendor-a', dto as never)).rejects.toBeInstanceOf(ConflictException);
    expect(findUnique).toHaveBeenCalledWith({
      where: { vendorId_customerCode: { vendorId: 'vendor-a', customerCode: 'L1' } },
    });
  });
});
