import { z } from 'zod';

/**
 * Historical Product Cost & COGS (docs/features/product-cost-history-and-cogs.md §7).
 * Per this codebase's known Zod gotcha (see `features/products/schemas/index.ts`):
 * no `.default()` on any field feeding a form resolver — set defaults via the
 * form's `defaultValues` instead.
 *
 * `note` is left optional here at the schema layer — the backend only requires
 * it when an insert backdates into (and trims) an existing row, which the Add
 * form determines client-side from the already-loaded history and enforces
 * via `setError('note', ...)` at submit time (see `add-cost-form.tsx`), not a
 * static zod rule.
 */
export const addCostSchema = z.object({
  costPerUnit: z.number({ error: 'Enter a cost per unit' }).positive('Must be greater than 0'),
  effectiveFrom: z.string().min(1, 'Effective date is required'),
  note: z.string().max(500, 'Note must be 500 characters or fewer').optional(),
  invoiceRef: z.string().max(200, 'Invoice reference must be 200 characters or fewer').optional(),
});

export type AddCostInput = z.infer<typeof addCostSchema>;

/** Controlled Edit (design doc §4.4) — `costPerUnit` only; `note` (the reason) is always mandatory. */
export const editCostSchema = z.object({
  costPerUnit: z.number({ error: 'Enter a cost per unit' }).positive('Must be greater than 0'),
  note: z.string().min(3, 'A reason is required (at least 3 characters)').max(500, 'Note must be 500 characters or fewer'),
});

export type EditCostInput = z.infer<typeof editCostSchema>;
