import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useQueryState, parseAsInteger, parseAsString, parseAsFloat } from 'nuqs';
import { toast } from 'sonner';
import type { CustomerDetail, CustomerConsumption, CustomerScheduleItem, PaymentTypeValue } from '@water-supply-crm/types';
import { customersApi } from '../api/customers.api';
import { queryKeys } from '../../../lib/query-keys';

export const useCustomers = () => {
  const [search] = useQueryState('search', parseAsString.withDefault(''));
  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1));
  const [limit, setLimit] = useQueryState('limit', parseAsInteger.withDefault(20));
  const [routeId] = useQueryState('routeId', parseAsString.withDefault(''));
  const [vanId] = useQueryState('vanId', parseAsString.withDefault(''));
  const [dayOfWeek] = useQueryState('dayOfWeek', parseAsInteger.withDefault(0));
  const [paymentType] = useQueryState('paymentType', parseAsString.withDefault(''));
  const [isActive, setIsActive] = useQueryState('isActive', parseAsString.withDefault('true'));
  const [hasPortalAccess, setHasPortalAccess] = useQueryState('hasPortalAccess', parseAsString.withDefault('all'));
  const [balanceMin] = useQueryState('balanceMin', parseAsFloat.withDefault(NaN));
  const [balanceMax] = useQueryState('balanceMax', parseAsFloat.withDefault(NaN));
  const [notDeliveredInDays] = useQueryState('notDeliveredInDays', parseAsInteger.withDefault(0));
  const [notPaidInDays] = useQueryState('notPaidInDays', parseAsInteger.withDefault(0));
  const [sort, setSort] = useQueryState('sort', parseAsString.withDefault(''));
  const [sortDir, setSortDir] = useQueryState('sortDir', parseAsString.withDefault(''));

  const params = {
    search: search || undefined,
    page,
    limit,
    routeId: routeId || undefined,
    vanId: vanId || undefined,
    dayOfWeek: dayOfWeek || undefined,
    paymentType: (['MONTHLY', 'CASH'] as const).includes(paymentType as PaymentTypeValue)
      ? (paymentType as PaymentTypeValue)
      : undefined,
    isActive: isActive === 'true' ? true : isActive === 'false' ? false : undefined,
    hasPortalAccess: hasPortalAccess === 'true' ? true : hasPortalAccess === 'false' ? false : undefined,
    balanceMin: !isNaN(balanceMin) ? balanceMin : undefined,
    balanceMax: !isNaN(balanceMax) ? balanceMax : undefined,
    notDeliveredInDays: notDeliveredInDays > 0 ? notDeliveredInDays : undefined,
    notPaidInDays: notPaidInDays > 0 ? notPaidInDays : undefined,
    sort: sort || undefined,
    sortDir: (sortDir as 'asc' | 'desc') || undefined,
  };

  return {
    ...useQuery({
      queryKey: queryKeys.customers.all(params),
      queryFn: () => customersApi.getAll(params).then((r) => r.data),
    }),
    search,
    page,
    setPage,
    limit,
    setLimit,
    routeId,
    vanId,
    dayOfWeek,
    paymentType,
    isActive,
    setIsActive,
    hasPortalAccess,
    setHasPortalAccess,
    balanceMin,
    balanceMax,
    notDeliveredInDays,
    notPaidInDays,
    sort,
    setSort,
    sortDir,
    setSortDir,
  };
};

export const useAllCustomers = () => {
  return useQuery({
    queryKey: ['customers', 'all'],
    queryFn: async () => {
      const first = await customersApi.getAll({ limit: 100, page: 1 }).then((r) => r.data);
      // paginate() nests pagination info under `meta` — totalPages is NOT top-level
      const totalPages: number = (first as any).meta?.totalPages ?? (first as any).totalPages ?? 1;
      if (totalPages <= 1) return first;
      const rest = await Promise.all(
        Array.from({ length: totalPages - 1 }, (_, i) =>
          customersApi.getAll({ limit: 100, page: i + 2 }).then((r) => (r.data as any).data)
        )
      );
      return { ...(first as any), data: [...(first as any).data, ...rest.flat()] };
    },
  });
};

/**
 * Server-side customer search for comboboxes — searches name, customerCode and
 * phoneNumber on the backend. Debounce the input before passing it here.
 */
export const useCustomerSearch = (search: string, enabled = true) => {
  return useQuery({
    queryKey: ['customers', 'combobox-search', search],
    queryFn: () =>
      customersApi
        .getAll({ search: search || undefined, isActive: true, limit: 20, page: 1 })
        .then((r) => r.data),
    enabled,
    placeholderData: (prev) => prev,
  });
};

export const useCustomer = (id: string) => {
  return useQuery({
    queryKey: queryKeys.customers.one(id),
    queryFn: (): Promise<CustomerDetail> => customersApi.getOne(id).then((r) => r.data),
    enabled: !!id,
  });
};

export const useCreateCustomer = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => customersApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      toast.success('Customer created successfully');
    },
    onError: () => toast.error('Failed to create customer'),
  });
};

export const useUpdateCustomer = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      customersApi.update(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.customers.one(id) });
      toast.success('Customer updated successfully');
    },
    onError: () => toast.error('Failed to update customer'),
  });
};

export const useDeleteCustomer = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => customersApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      toast.success('Customer deleted');
    },
    onError: () => toast.error('Failed to delete customer'),
  });
};

/**
 * Shape of the 409 body the backend sends when a plain deactivate is blocked —
 * the customer still owes money and/or is still holding company bottles.
 */
export interface DeactivateBlockedError {
  code: 'DEACTIVATE_BLOCKED';
  message: string;
  customerName: string;
  /** > 0 when a balance write-off is one of the blockers. */
  financialBalance: number;
  /** non-empty when a bottle write-off is one of the blockers. */
  outstandingBottles: Array<{ product: string; balance: number }>;
}

export const isDeactivateBlockedError = (e: unknown): DeactivateBlockedError | null => {
  const body = (e as any)?.response?.data;
  return body?.code === 'DEACTIVATE_BLOCKED' ? (body as DeactivateBlockedError) : null;
};

export const useDeactivateCustomer = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, force = false }: { id: string; force?: boolean }) =>
      customersApi.deactivate(id, force),
    onSuccess: (res: any, { force }) => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      const cancelled = Number(res?.data?.cancelledDeliveries ?? 0);
      let base = 'Customer deactivated';
      if (force) {
        const wrote: string[] = [];
        const off = Number(res?.data?.writtenOff ?? 0);
        const btl = (res?.data?.bottlesWrittenOff ?? []) as Array<{ balance: number }>;
        if (off > 0) wrote.push(`₨${off.toLocaleString()}`);
        const btlTotal = btl.reduce((s, b) => s + Number(b.balance ?? 0), 0);
        if (btlTotal !== 0) wrote.push(`${btlTotal} bottle${btlTotal === 1 ? '' : 's'}`);
        base = wrote.length
          ? `Customer force-deactivated — ${wrote.join(' + ')} written off as company loss`
          : 'Customer force-deactivated';
      }
      toast.success(cancelled > 0 ? `${base}. ${cancelled} pending deliver${cancelled === 1 ? 'y' : 'ies'} cancelled` : base);
    },
    onError: (e: any) => {
      // The DEACTIVATE_BLOCKED 409 is not a failure to surface as a toast — the
      // caller turns it into the Force Deactivate escalation flow.
      if (isDeactivateBlockedError(e)) return;
      toast.error(e?.response?.data?.message ?? 'Failed to deactivate customer');
    },
  });
};

export const useReactivateCustomer = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => customersApi.reactivate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      toast.success('Customer reactivated');
    },
    onError: () => toast.error('Failed to reactivate customer'),
  });
};

export const useRemovePortalAccount = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => customersApi.removePortalAccount(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.customers.one(id) });
      toast.success('Portal access revoked');
    },
    onError: () => toast.error('Failed to revoke portal access'),
  });
};

export const useCustomerConsumption = (
  id: string,
  params: { from?: string; to?: string; allTime?: boolean },
) => {
  const resolvedParams: Record<string, string> = params.allTime
    ? { allTime: 'true' }
    : {
        ...(params.from ? { from: params.from } : {}),
        ...(params.to ? { to: params.to } : {}),
      };
  return useQuery({
    queryKey: ['customers', id, 'consumption', resolvedParams],
    queryFn: (): Promise<CustomerConsumption> =>
      customersApi.getConsumption(id, resolvedParams).then((r) => r.data),
    enabled: !!id,
  });
};

export interface StatementDeliveryRow {
  date: string;
  trans: string;
  btlDelivered: number;
  emptyPickup: number;
  bottleBalance: number | null;
  amountDue: number;
  amountReceived: number;
  runningBalance: number;
}

export interface StatementOtherRow {
  date: string;
  type: string;
  description: string;
  amount: number;
  runningBalance: number;
}

export interface CustomerStatementData {
  customer: {
    id: string;
    name: string;
    customerCode: string;
    address: string;
    phoneNumber: string;
    paymentType: 'MONTHLY' | 'CASH' | null;
  };
  period: string;
  month: string;
  toMonth: string;
  openingBalance: number;
  closingBalance: number;
  ratePerBottle: number;
  deliveryRows: StatementDeliveryRow[];
  otherRows: StatementOtherRow[];
  totals: {
    totalBtl: number;
    totalEmpty: number;
    totalDue: number;
    totalRecv: number;
    finalBalance: number;
  };
}

export const useCustomerStatement = (id: string, params: { month: string; toMonth?: string }) =>
  useQuery({
    queryKey: ['customers', id, 'statement-data', params.month, params.toMonth ?? params.month],
    queryFn: (): Promise<CustomerStatementData> =>
      customersApi
        .getStatementData(id, {
          month: params.month,
          ...(params.toMonth && params.toMonth !== params.month ? { toMonth: params.toMonth } : {}),
        })
        .then((r) => r.data),
    enabled: !!id && !!params.month,
    placeholderData: (prev) => prev,
  });

export const useCustomerSchedule = (id: string, params?: { dateFrom?: string; dateTo?: string }) =>
  useQuery({
    queryKey: ['customers', id, 'schedule', params?.dateFrom, params?.dateTo],
    queryFn: (): Promise<CustomerScheduleItem[]> =>
      customersApi.getSchedule(id, params).then((r) => r.data),
    enabled: !!id && !!params?.dateFrom,
  });

export const useSetCustomPrice = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ customerId, data }: { customerId: string; data: Record<string, unknown> }) =>
      customersApi.setCustomPrice(customerId, data),
    onSuccess: (_, { customerId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.customers.one(customerId) });
      toast.success('Custom price saved');
    },
    onError: () => toast.error('Failed to save custom price'),
  });
};

export const useRemoveCustomPrice = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ customerId, productId }: { customerId: string; productId: string }) =>
      customersApi.removeCustomPrice(customerId, productId),
    onSuccess: (_, { customerId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.customers.one(customerId) });
      toast.success('Custom price removed');
    },
    onError: () => toast.error('Failed to remove custom price'),
  });
};

export interface BulkScheduleUpdateResult {
  requestedCount: number;
  updatedCount: number;
  skippedCount: number;
  skipped: Array<{ customerId: string; name: string; reason: string }>;
}

export const useBulkUpdateSchedule = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { customerIds: string[]; vanId?: string; dayOfWeek?: number }): Promise<BulkScheduleUpdateResult> =>
      customersApi.bulkUpdateSchedule(data).then((r) => r.data),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      if (result.skippedCount > 0) {
        toast.warning(
          `Updated ${result.updatedCount} of ${result.requestedCount} customer(s) — ${result.skippedCount} skipped (no van assigned)`,
        );
      } else {
        toast.success(`Updated schedule for ${result.updatedCount} customer(s)`);
      }
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to update schedule'),
  });
};

export interface BulkDeactivateResult {
  requestedCount: number;
  deactivatedCount: number;
  forceDeactivatedCount: number;
  writtenOff: number;
  bottlesWrittenOff: number;
  cancelledDeliveries: number;
  skippedCount: number;
  skipped: Array<{ customerId: string; name: string; reason: string }>;
}

export const useBulkDeactivateCustomers = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ customerIds, force = false }: { customerIds: string[]; force?: boolean }): Promise<BulkDeactivateResult> =>
      customersApi.bulkDeactivate(customerIds, force).then((r) => r.data),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      const cancelledSuffix = result.cancelledDeliveries > 0
        ? ` · ${result.cancelledDeliveries} pending deliver${result.cancelledDeliveries === 1 ? 'y' : 'ies'} cancelled`
        : '';
      const writeOffBits: string[] = [];
      if (result.writtenOff > 0) writeOffBits.push(`₨${result.writtenOff.toLocaleString()}`);
      if (result.bottlesWrittenOff > 0) writeOffBits.push(`${result.bottlesWrittenOff} bottle line${result.bottlesWrittenOff === 1 ? '' : 's'}`);
      const writeOffSuffix = writeOffBits.length
        ? ` · ${writeOffBits.join(' + ')} written off as company loss (${result.forceDeactivatedCount} force-deactivated)`
        : '';
      if (result.deactivatedCount === 0) {
        toast.error(`No customers deactivated — all ${result.skippedCount} skipped (outstanding bottles or balance)`);
      } else if (result.skippedCount > 0) {
        toast.warning(
          `Deactivated ${result.deactivatedCount} of ${result.requestedCount} — ${result.skippedCount} skipped (outstanding bottles or balance)${cancelledSuffix}${writeOffSuffix}`,
        );
      } else {
        toast.success(`Deactivated ${result.deactivatedCount} customer${result.deactivatedCount !== 1 ? 's' : ''}${cancelledSuffix}${writeOffSuffix}`);
      }
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to deactivate customers'),
  });
};

export const useUpdateCustomerLocation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ customerId, latitude, longitude, address }: { customerId: string; latitude: number; longitude: number; address?: string }) => {
      await customersApi.updateLocation(customerId, latitude, longitude);
      if (address) await customersApi.update(customerId, { address });
    },
    onSuccess: (_, { customerId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.customers.one(customerId) });
      toast.success('Location updated');
    },
    onError: () => toast.error('Failed to update location'),
  });
};
