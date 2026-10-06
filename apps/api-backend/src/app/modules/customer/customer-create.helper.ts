import { Prisma } from '@prisma/client';

export interface CreateCustomerRecordsInput {
  vendorId: string;
  /** Scalar Customer columns (name, phoneNumber, address, paymentType, financialBalance, …). */
  customer: Omit<Prisma.CustomerUncheckedCreateInput, 'vendorId' | 'customerCode'>;
  customerCode: string;
  deliverySchedule?: { vanId: string; dayOfWeek: number; routeSequence?: number | null }[];
  /** Per-customer price override, stored only when both are given. */
  defaultProductId?: string;
  defaultPrice?: number;
  /** Opening bottle count per product; products not listed start at 0. */
  walletBalances?: Record<string, number>;
  /** Pre-loaded active products — a bulk caller passes this to avoid one lookup per row. */
  activeProductIds?: string[];
}

/**
 * The in-transaction half of customer creation — the customer row, its optional weekly
 * schedule, one BottleWallet per active product, and the optional custom price.
 *
 * Shared by `CustomerService.create` (manual) and the vendor data-import executor so the
 * two can never drift apart. Deliberately does NOT touch cache or audit: the caller owns
 * both (the import does them once per batch, not once per row).
 */
export async function createCustomerRecords(tx: Prisma.TransactionClient, input: CreateCustomerRecordsInput) {
  const { vendorId, customerCode } = input;

  const customer = await tx.customer.create({
    data: { ...input.customer, customerCode, vendorId },
  });

  if (input.deliverySchedule?.length) {
    await tx.customerDeliverySchedule.createMany({
      data: input.deliverySchedule.map((s) => ({
        customerId: customer.id,
        vanId: s.vanId,
        dayOfWeek: s.dayOfWeek,
        routeSequence: s.routeSequence ?? null,
      })),
    });
  }

  const productIds =
    input.activeProductIds ??
    (await tx.product.findMany({ where: { vendorId, isActive: true }, select: { id: true } })).map((p) => p.id);

  for (const productId of productIds) {
    await tx.bottleWallet.create({
      data: { customerId: customer.id, productId, balance: input.walletBalances?.[productId] ?? 0 },
    });
  }

  if (input.defaultProductId !== undefined && input.defaultPrice !== undefined) {
    await tx.customerProductPrice.upsert({
      where: { customerId_productId: { customerId: customer.id, productId: input.defaultProductId } },
      create: { customerId: customer.id, productId: input.defaultProductId, customPrice: input.defaultPrice },
      update: { customPrice: input.defaultPrice },
    });
  }

  return customer;
}
