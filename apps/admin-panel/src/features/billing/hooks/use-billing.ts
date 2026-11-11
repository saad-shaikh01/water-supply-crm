'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { billingApi, type AssignSubscriptionInput, type CreateInvoiceInput, type PlanInput, type RecordPaymentInput } from '../api/billing.api';
import { queryKeys } from '../../../lib/query-keys';
import { apiErrorMessage } from '../../../lib/api-error';
import { billingErrorText } from '../lib/billing';

const err = (e: unknown, f: string) => billingErrorText(e, f, apiErrorMessage);

export const usePlans = () => useQuery({ queryKey: queryKeys.billing.plans, queryFn: () => billingApi.plans(true) });

export const useSubscriptions = (params: object) =>
  useQuery({
    queryKey: queryKeys.billing.subscriptions(params),
    queryFn: () => billingApi.subscriptions(params),
    placeholderData: keepPreviousData,
  });

export const useVendorSubscription = (vendorId: string | null) =>
  useQuery({
    queryKey: queryKeys.billing.vendorSubscription(vendorId ?? ''),
    queryFn: () => billingApi.vendorSubscription(vendorId as string),
    enabled: !!vendorId,
  });

export const useInvoices = (params: object) =>
  useQuery({
    queryKey: queryKeys.billing.invoices(params),
    queryFn: () => billingApi.invoices(params),
    placeholderData: keepPreviousData,
  });

export const useInvoice = (id: string | null) =>
  useQuery({ queryKey: queryKeys.billing.invoice(id ?? ''), queryFn: () => billingApi.invoice(id as string), enabled: !!id });

/** Everything under `billing` can change when a plan, subscription or invoice changes. */
function useBillingMutation<V, R>(fn: (v: V) => Promise<R>, success: string | ((r: R) => void), failure: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: queryKeys.billing.all });
      if (typeof success === 'string') toast.success(success);
      else success(r);
    },
    onError: (e) => toast.error(err(e, failure)),
  });
}

export const useCreatePlan = () => useBillingMutation((b: PlanInput) => billingApi.createPlan(b), 'Plan created', 'Failed to create plan');

export const useUpdatePlan = () =>
  useBillingMutation(
    (v: { id: string; body: Partial<PlanInput> }) => billingApi.updatePlan(v.id, v.body),
    (plan) => {
      toast.success('Plan updated');
      if (plan.affectedVendors) toast.warning(`${plan.affectedVendors} vendor(s) are now over the new limits. Their data is kept; new records are blocked.`);
    },
    'Failed to update plan',
  );

export const useDeletePlan = () => useBillingMutation((id: string) => billingApi.deletePlan(id), 'Plan deleted', 'Failed to delete plan');

export const useAssignSubscription = () =>
  useBillingMutation(
    (v: { vendorId: string; body: AssignSubscriptionInput }) => billingApi.assign(v.vendorId, v.body),
    (r) => {
      toast.success('Subscription saved');
      if (r.warnings?.includes('USAGE_EXCEEDS_LIMIT')) toast.warning('The vendor is currently over the limits of this plan. Existing data is kept; new records are blocked until usage drops.');
    },
    'Failed to save subscription',
  );

export const useCancelSubscription = () =>
  useBillingMutation((v: { vendorId: string; reason: string }) => billingApi.cancel(v.vendorId, v.reason), 'Subscription cancelled', 'Failed to cancel subscription');

export const useReactivateSubscription = () =>
  useBillingMutation((vendorId: string) => billingApi.reactivate(vendorId), 'Subscription reactivated', 'Failed to reactivate subscription');

export const useCreateInvoice = () =>
  useBillingMutation((b: CreateInvoiceInput) => billingApi.createInvoice(b), (i) => toast.success(`Invoice ${i.number} created`), 'Failed to create invoice');

export const useIssueInvoice = () => useBillingMutation((id: string) => billingApi.issueInvoice(id), 'Invoice issued', 'Failed to issue invoice');

export const useRecordPayment = () =>
  useBillingMutation(
    (v: { id: string; body: RecordPaymentInput }) => billingApi.recordPayment(v.id, v.body),
    (r) => toast.success(r.invoice.status === 'PAID' ? 'Payment recorded. Invoice is fully paid.' : 'Partial payment recorded'),
    'Failed to record payment',
  );

export const useVoidInvoice = () =>
  useBillingMutation((v: { id: string; reason: string }) => billingApi.voidInvoice(v.id, v.reason), 'Invoice voided', 'Failed to void invoice');
