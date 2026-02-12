'use client';

import { Card, CardContent, CardHeader, CardTitle, Skeleton } from '@water-supply-crm/ui';
import { Wallet, Droplets, TrendingUp, TrendingDown } from 'lucide-react';
import { useAuthStore } from '../../../store/auth.store';
import { useCustomerProfile, useWalletSummary } from '../hooks/use-wallet';

export function WalletCard() {
  const user = useAuthStore((s) => s.user);
  const { data: profile, isLoading: profileLoading } = useCustomerProfile(user?.customerId);
  const { data: summary, isLoading: summaryLoading } = useWalletSummary(user?.customerId);

  const isLoading = profileLoading || summaryLoading;

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {/* Wallet Balance */}
      <Card className="sm:col-span-2">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Wallet Balance
          </CardTitle>
          <Wallet className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-8 w-32" />
          ) : (
            <div className="text-3xl font-bold">
              Rs. {(profile?.walletBalance ?? 0).toLocaleString()}
            </div>
          )}
          <p className="text-xs text-muted-foreground mt-1">Current account balance</p>
        </CardContent>
      </Card>

      {/* Bottles on Hand */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Bottles
          </CardTitle>
          <Droplets className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-8 w-16" />
          ) : (
            <div className="text-3xl font-bold">{profile?.bottleCount ?? 0}</div>
          )}
          <p className="text-xs text-muted-foreground mt-1">Bottles on hand</p>
        </CardContent>
      </Card>

      {/* Total Paid */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Total Paid
          </CardTitle>
          <TrendingUp className="h-4 w-4 text-green-500" />
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-8 w-24" />
          ) : (
            <div className="text-3xl font-bold text-green-600">
              Rs. {(summary?.totalCredits ?? 0).toLocaleString()}
            </div>
          )}
          <p className="text-xs text-muted-foreground mt-1">Total credits</p>
        </CardContent>
      </Card>
    </div>
  );
}
