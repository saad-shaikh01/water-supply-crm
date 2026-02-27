'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, Skeleton, Button } from '@water-supply-crm/ui';
import { Wallet, Droplets, TrendingUp, Plus, CreditCard, CalendarCheck } from 'lucide-react';
import { usePortalProfile, usePortalBalance, usePortalSummary } from '../hooks/use-wallet';
import { PaymentDialog } from '../../payments/components/payment-dialog';

function formatNextDelivery(dateStr: string | null | undefined): string {
  if (!dateStr) return 'No upcoming delivery';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-PK', { weekday: 'short', day: 'numeric', month: 'short' });
}

export function WalletCard() {
  const { data: profile, isLoading: profileLoading } = usePortalProfile();
  const { data: balanceData, isLoading: balanceLoading } = usePortalBalance();
  const { data: summary, isLoading: summaryLoading } = usePortalSummary();
  const [paymentOpen, setPaymentOpen] = useState(false);

  const isLoading = profileLoading || balanceLoading;
  const balance = Number(profile?.financialBalance ?? 0);
  const bottleWallets = balanceData?.bottleWallets ?? [];
  const totalBottles = bottleWallets.reduce((sum, w) => sum + (w.quantity ?? 0), 0);

  const nextDeliveryText = summaryLoading
    ? '...'
    : formatNextDelivery(summary?.nextDeliveryDate);

  const totalPaid = summary?.totalPaid ?? 0;
  const lastPaymentAmount = summary?.lastPaymentAmount ?? null;
  const lastPaymentDate = summary?.lastPaymentDate
    ? new Date(summary.lastPaymentDate).toLocaleDateString('en-PK', { day: 'numeric', month: 'short' })
    : null;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* Main Balance Card */}
        <div className="sm:col-span-2 lg:col-span-2">
          <Card className="relative overflow-hidden border-none bg-gradient-to-br from-primary to-blue-700 text-primary-foreground shadow-2xl shadow-primary/20 rounded-2xl dark:shadow-none">
            <CardContent className="p-8">
              <div className="flex justify-between items-start">
                <div className="space-y-1">
                  <p className="text-xs font-bold uppercase tracking-widest opacity-80">Outstanding Balance</p>
                  {isLoading ? (
                    <Skeleton className="h-10 w-40 bg-white/20" />
                  ) : (
                    <div className="text-4xl font-black font-mono">
                      ₨ {balance.toLocaleString()}
                    </div>
                  )}
                </div>
                <div className="h-12 w-12 rounded-2xl bg-white/20 backdrop-blur-md flex items-center justify-center">
                  <Wallet className="h-6 w-6" />
                </div>
              </div>

              <div className="mt-8 flex flex-col sm:flex-row items-center gap-4">
                <Button
                  onClick={() => setPaymentOpen(true)}
                  className="w-full sm:w-auto rounded-xl bg-white text-primary hover:bg-white/90 font-black px-8 py-6 h-auto shadow-lg transition-colors"
                >
                  <Plus className="mr-2 h-5 w-5" />
                  Pay Now
                </Button>
                <div className="flex items-center gap-2 text-xs font-bold opacity-80">
                  <CalendarCheck className="h-4 w-4" />
                  <span>Next delivery: {nextDeliveryText}</span>
                </div>
              </div>

              {/* Decorative Background Elements */}
              <div className="absolute -right-10 -bottom-10 w-40 h-40 bg-white/10 rounded-full blur-3xl" />
              <div className="absolute right-10 top-10 w-20 h-20 bg-blue-400/20 rounded-full blur-2xl" />
            </CardContent>
          </Card>
        </div>

        {/* Bottles Card */}
        <div>
          <Card className="h-full rounded-2xl border-border/50 bg-card/50 backdrop-blur-sm dark:glass-surface">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                <Droplets className="h-3 w-3 text-blue-500" /> Inventory
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <div className="text-3xl font-black font-mono">{totalBottles}</div>
              )}
              <p className="text-[10px] text-muted-foreground mt-1 font-bold uppercase">Bottles at Home</p>
              {bottleWallets.length > 0 && (
                <div className="mt-3 space-y-1 pt-3 border-t border-border/50">
                  {bottleWallets.map((w) => (
                    <div key={w.productId} className="flex justify-between text-[11px] font-medium text-muted-foreground">
                      <span>{w.product?.name}</span>
                      <span className="font-mono font-bold">{w.quantity} × ₨{w.effectivePrice}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="rounded-2xl border-border/50 bg-emerald-500/5 dark:bg-emerald-500/5 dark:glass-surface">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="h-10 w-10 rounded-xl bg-emerald-500/20 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
              <TrendingUp className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase text-muted-foreground">Total Paid</p>
              {summaryLoading ? (
                <Skeleton className="h-5 w-20 mt-1" />
              ) : (
                <p className="text-lg font-black font-mono text-emerald-600 dark:text-emerald-400">
                  ₨ {Number(totalPaid).toLocaleString()}
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-border/50 bg-blue-500/5 dark:bg-blue-500/5 dark:glass-surface">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="h-10 w-10 rounded-xl bg-blue-500/20 flex items-center justify-center text-blue-600 dark:text-blue-400">
              <CreditCard className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase text-muted-foreground">Last Payment</p>
              {summaryLoading ? (
                <Skeleton className="h-5 w-20 mt-1" />
              ) : lastPaymentAmount !== null ? (
                <div>
                  <p className="text-lg font-black font-mono text-blue-600 dark:text-blue-400">
                    ₨ {Number(lastPaymentAmount).toLocaleString()}
                  </p>
                  {lastPaymentDate && (
                    <p className="text-[10px] text-muted-foreground">{lastPaymentDate}</p>
                  )}
                </div>
              ) : (
                <p className="text-lg font-black font-mono text-blue-600 dark:text-blue-400">—</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <PaymentDialog
        open={paymentOpen}
        onOpenChange={setPaymentOpen}
        suggestedAmount={balance > 0 ? balance : 0}
      />
    </div>
  );
}
