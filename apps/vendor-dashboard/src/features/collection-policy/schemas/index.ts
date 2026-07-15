import { z } from 'zod';

export const collectionPolicySchema = z.object({
  enabled: z.boolean(),
  minOutstandingThreshold: z.number().min(0, 'Must be 0 or more'),
  minCollectionPercentage: z.number().min(0, 'Must be at least 0%').max(100, 'Must be 100% or less'),
  allowedShortfall: z.number().min(0, 'Must be 0 or more'),
});

export type CollectionPolicyInput = z.infer<typeof collectionPolicySchema>;

export const cashCollectionPolicySchema = z
  .object({
    enabled: z.boolean(),
    allowedCreditDeliveries: z
      .number()
      .int('Must be a whole number')
      .min(0, 'Must be 0 or more')
      .max(10, 'Must be 10 or less'),
    minExposureFloor: z.number().min(0, 'Must be 0 or more'),
    maxOutstandingCeiling: z.number().min(0, 'Must be 0 or more').nullable(),
  })
  .refine(
    (data) => data.maxOutstandingCeiling == null || data.maxOutstandingCeiling >= data.minExposureFloor,
    {
      message: 'Absolute limit must be empty or at least the minimum amount',
      path: ['maxOutstandingCeiling'],
    },
  );

export type CashCollectionPolicyInput = z.infer<typeof cashCollectionPolicySchema>;
