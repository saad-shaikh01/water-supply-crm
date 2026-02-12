import { useQuery } from '@tanstack/react-query';
import { walletApi } from '../api/wallet.api';
import { queryKeys } from '../../../lib/query-keys';

export const useCustomerProfile = (customerId: string | undefined) =>
  useQuery({
    queryKey: queryKeys.customer.profile(customerId ?? ''),
    queryFn: () => walletApi.getProfile(customerId!).then((r) => r.data),
    enabled: !!customerId,
  });

export const useWalletSummary = (customerId: string | undefined) =>
  useQuery({
    queryKey: queryKeys.transactions.summary(customerId ?? ''),
    queryFn: () => walletApi.getSummary(customerId!).then((r) => r.data),
    enabled: !!customerId,
  });
