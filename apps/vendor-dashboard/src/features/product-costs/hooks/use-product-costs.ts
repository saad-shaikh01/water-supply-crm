import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { queryKeys } from '../../../lib/query-keys';
import {
  productCostsApi,
  type ProductCost,
  type ProductCostKind,
  type CreateProductCostPayload,
  type EditProductCostPayload,
  type VoidProductCostPayload,
} from '../api/product-costs.api';

/** GET /product-costs/product/:productId?kind=... — full history for one cost
 *  stream, most-recent-first (incl. voided rows). Defaults to BOTTLE. */
export const useProductCostHistory = (productId: string | null | undefined, kind: ProductCostKind = 'BOTTLE', enabled = true) =>
  useQuery({
    queryKey: queryKeys.productCosts.history(productId ?? '', kind),
    queryFn: (): Promise<ProductCost[]> => productCostsApi.listHistory(productId as string, kind).then((r) => r.data),
    enabled: !!productId && enabled,
  });

/** POST /product-costs — Add (design doc §4.1); backend performs the split/trim itself. */
export const useCreateProductCost = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateProductCostPayload) => productCostsApi.create(data).then((r) => r.data),
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.productCosts.history(variables.productId, variables.kind ?? 'BOTTLE') });
      toast.success('Cost recorded');
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to record cost'),
  });
};

/** PATCH /product-costs/:id — Controlled Edit, `costPerUnit` only (design doc §4.4). */
export const useEditProductCost = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, productId, kind, data }: { id: string; productId: string; kind: ProductCostKind; data: EditProductCostPayload }) =>
      productCostsApi.edit(id, data).then((r) => r.data),
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.productCosts.history(variables.productId, variables.kind) });
      toast.success('Cost updated');
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to update cost'),
  });
};

/** POST /product-costs/:id/void — Void the current row only (design doc §4.3). */
export const useVoidProductCost = () => {
  const queryClient = useQueryClient();
  return useMutation({
    retry: 0,
    mutationFn: ({ id, productId, kind, data }: { id: string; productId: string; kind: ProductCostKind; data: VoidProductCostPayload }) =>
      productCostsApi.voidRow(id, data).then((r) => r.data),
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.productCosts.history(variables.productId, variables.kind) });
      toast.success('Cost row voided');
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to void cost row'),
  });
};
