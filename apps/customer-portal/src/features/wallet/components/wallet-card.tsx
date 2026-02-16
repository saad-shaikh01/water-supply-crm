'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, Skeleton, Button, Badge } from '@water-supply-crm/ui';
import { Wallet, Droplets, TrendingUp, ArrowUpRight, Plus, CreditCard } from 'lucide-react';
import { useAuthStore } from '../../../store/auth.store';
import { useCustomerProfile, useWalletSummary } from '../hooks/use-wallet';
import { cn } from '@water-supply-crm/ui';
import { motion } from 'framer-motion';
import { PaymentDialog } from '../../payments/components/payment-dialog';

export function WalletCard() {
  const user = useAuthStore((s) => s.user);
  const { data: profile, isLoading: profileLoading } = useCustomerProfile(user?.customerId);
  const { data: summary, isLoading: summaryLoading } = useWalletSummary(user?.customerId);
  const [paymentOpen, setPaymentOpen] = useState(false);

  const isLoading = profileLoading || summaryLoading;
  const balance = Number(profile?.financialBalance ?? 0);
  const isNegative = balance > 0; // Customer owes money

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* Main Balance Card */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="sm:col-span-2 lg:col-span-2"
        >
          <Card className="relative overflow-hidden border-none bg-gradient-to-br from-primary to-blue-700 text-primary-foreground shadow-2xl shadow-primary/20 rounded-[2rem]">
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
                  className="w-full sm:w-auto rounded-2xl bg-white text-primary hover:bg-white/90 font-black px-8 py-6 h-auto shadow-lg active:scale-95 transition-all"
                >
                  <Plus className="mr-2 h-5 w-5" />
                  Pay Now
                </Button>
                <div className="flex items-center gap-2 text-xs font-bold opacity-80">
                  <TrendingUp className="h-4 w-4" />
                  <span>Next delivery scheduled for tomorrow</span>
                </div>
              </div>

              {/* Decorative Background Elements */}
              <div className="absolute -right-10 -bottom-10 w-40 h-40 bg-white/10 rounded-full blur-3xl" />
              <div className="absolute right-10 top-10 w-20 h-20 bg-blue-400/20 rounded-full blur-2xl" />
            </CardContent>
          </Card>
        </motion.div>
...
      <PaymentDialog 
        open={paymentOpen} 
        onOpenChange={setPaymentOpen} 
        suggestedAmount={balance > 0 ? balance : 0}
      />
    </div>
  );
}

        {/* Bottles Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <Card className="h-full rounded-[2rem] border-border/50 bg-card/50 backdrop-blur-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                <Droplets className="h-3 w-3 text-blue-500" /> Inventory
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <div className="text-3xl font-black font-mono">{profile?.bottleCount ?? 0}</div>
              )}
              <p className="text-[10px] text-muted-foreground mt-1 font-bold uppercase">Bottles at Home</p>
              
              <div className="mt-4 pt-4 border-t border-border/50">
                <div className="flex justify-between items-center text-[10px] font-bold uppercase">
                  <span className="text-muted-foreground">Limit</span>
                  <span className="text-primary">10 Units</span>
                </div>
                <div className="w-full bg-accent h-1.5 rounded-full mt-1 overflow-hidden">
                  <div 
                    className="bg-primary h-full transition-all duration-1000" 
                    style={{ width: `${Math.min(((profile?.bottleCount ?? 0) / 10) * 100, 100)}%` }} 
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="rounded-2xl border-border/50 bg-emerald-500/5 dark:bg-emerald-500/10">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="h-10 w-10 rounded-xl bg-emerald-500/20 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
              <TrendingUp className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase text-muted-foreground">Total Paid</p>
              <p className="text-lg font-black font-mono text-emerald-600 dark:text-emerald-400">
                ₨ {(summary?.totalCredits ?? 0).toLocaleString()}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-border/50 bg-blue-500/5 dark:bg-blue-500/10">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="h-10 w-10 rounded-xl bg-blue-500/20 flex items-center justify-center text-blue-600 dark:text-blue-400">
              <CreditCard className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase text-muted-foreground">Last Payment</p>
              <p className="text-lg font-black font-mono text-blue-600 dark:text-blue-400">
                ₨ 2,500
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
