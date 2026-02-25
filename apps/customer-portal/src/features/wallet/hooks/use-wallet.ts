import { useQuery } from '@tanstack/react-query';
import { walletApi } from '../api/wallet.api';

export const usePortalProfile = () =>
  useQuery({
    queryKey: ['portal-me'],
    queryFn: () => walletApi.getProfile().then((r) => r.data),
  });

export const usePortalBalance = () =>
  useQuery({
    queryKey: ['portal-balance'],
    queryFn: () => walletApi.getBalance().then((r) => r.data),
  });

export const usePortalSummary = () =>
  useQuery({
    queryKey: ['portal-summary'],
    queryFn: () => walletApi.getSummary().then((r) => r.data),
  });

export const usePortalProducts = () =>
  useQuery({
    queryKey: ['portal-products'],
    queryFn: () => walletApi.getProducts().then((r) => r.data),
  });

// Keep legacy hook signature for backward compat — now ignores customerId param
export const useCustomerProfile = (_customerId?: string) => usePortalProfile();
export const useWalletSummary = (_customerId?: string) => usePortalBalance();
