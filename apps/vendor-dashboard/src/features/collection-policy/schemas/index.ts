import { z } from 'zod';

export const collectionPolicySchema = z.object({
  enabled: z.boolean(),
  minOutstandingThreshold: z.number().min(0, 'Must be 0 or more'),
  minCollectionPercentage: z.number().min(0, 'Must be at least 0%').max(100, 'Must be 100% or less'),
  allowedShortfall: z.number().min(0, 'Must be 0 or more'),
});

export type CollectionPolicyInput = z.infer<typeof collectionPolicySchema>;
