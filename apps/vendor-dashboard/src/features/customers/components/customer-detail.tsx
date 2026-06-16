'use client';

import { useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
  Card, CardContent, CardHeader, CardTitle,
  Skeleton, Button, Badge, Input, Label,
} from '@water-supply-crm/ui';
import {
  useCustomer,
  useRemovePortalAccount,
  useCustomerConsumption,
  useRemoveCustomPrice,
  useCustomerSchedule,
} from '../hooks/use-customers';
import { customersApi } from '../api/customers.api';
import { TransactionList } from '../../transactions/components/transaction-list';
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import {
  MapPin, Phone, User, Calendar,
  Wallet, Tag, ArrowLeft, Pencil,
  CreditCard, Droplets, Clock, Info,
  ShieldCheck, Trash2, Globe,
  Lock as LockIcon,
  TrendingUp, TrendingDown, FileText, ChevronDown,
  CalendarRange,
  ExternalLink, Navigation, Building2, Landmark,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@water-supply-crm/ui';
import type { CustomerDetail as CustomerDetailType, CustomerConsumption, CustomerScheduleItem } from '@water-supply-crm/types';
import { CustomerForm } from './customer-form';
import { PortalAccountDialog } from './dialogs/portal-account-dialog';
import { EditLocationDialog } from './dialogs/edit-location-dialog';
import { CustomPriceDialog } from './dialogs/custom-price-dialog';
import { ConfirmDialog } from '../../../components/shared/confirm-dialog';

// ---------------------------------------------------------------------------
// Consumption range picker (local — does NOT use nuqs to avoid clashing with
// the Transactions tab which binds from/to URL params via DateRangePicker)
// ---------------------------------------------------------------------------

type ConsumptionPreset = 'LAST_30' | 'THIS_MONTH' | 'LAST_MONTH' | 'LAST_3_MONTHS' | 'ALL_TIME' | 'CUSTOM';

interface ConsumptionRange {
  preset: ConsumptionPreset;
  from: string;
  to: string;
}

function toIso(d: Date) {
  return d.toISOString().slice(0, 10);
}

function fmtDisplay(dateStr: string) {
  if (!dateStr) return '';
  return new Date(dateStr + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function buildPresetRange(preset: Exclude<ConsumptionPreset, 'CUSTOM' | 'ALL_TIME'>): { from: string; to: string } {
  const today = new Date();
  switch (preset) {
    case 'LAST_30': {
      const from = new Date(today);
      from.setDate(from.getDate() - 29);
      return { from: toIso(from), to: toIso(today) };
    }
    case 'THIS_MONTH': {
      const from = new Date(today.getFullYear(), today.getMonth(), 1);
      return { from: toIso(from), to: toIso(today) };
    }
    case 'LAST_MONTH': {
      const from = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const to = new Date(today.getFullYear(), today.getMonth(), 0);
      return { from: toIso(from), to: toIso(to) };
    }
    case 'LAST_3_MONTHS': {
      const from = new Date(today);
      from.setMonth(from.getMonth() - 3);
      return { from: toIso(from), to: toIso(today) };
    }
  }
}

const CONSUMPTION_PRESETS: { label: string; value: ConsumptionPreset }[] = [
  { label: 'Last 30 Days', value: 'LAST_30' },
  { label: 'This Month', value: 'THIS_MONTH' },
  { label: 'Last Month', value: 'LAST_MONTH' },
  { label: 'Last 3 Months', value: 'LAST_3_MONTHS' },
  { label: 'All Time', value: 'ALL_TIME' },
  { label: 'Custom', value: 'CUSTOM' },
];

interface ConsumptionRangePickerProps {
  value: ConsumptionRange;
  onChange: (next: ConsumptionRange) => void;
}

function ConsumptionRangePicker({ value, onChange }: ConsumptionRangePickerProps) {
  const [open, setOpen] = useState(false);

  const activeLabel = CONSUMPTION_PRESETS.find((p) => p.value === value.preset)?.label ?? 'Custom';

  const triggerLabel =
    value.preset === 'CUSTOM'
      ? `${value.from ? fmtDisplay(value.from) : '…'} → ${value.to ? fmtDisplay(value.to) : '…'}`
      : value.preset === 'ALL_TIME'
      ? 'All Time'
      : activeLabel;

  const handlePreset = (preset: ConsumptionPreset) => {
    if (preset === 'ALL_TIME') {
      onChange({ preset, from: '', to: '' });
      setOpen(false);
      return;
    }
    if (preset === 'CUSTOM') {
      onChange({ ...value, preset });
      return; // keep popover open so user can edit dates
    }
    const range = buildPresetRange(preset as Exclude<ConsumptionPreset, 'CUSTOM' | 'ALL_TIME'>);
    onChange({ preset, ...range });
    setOpen(false);
  };

  const handleFromChange = (from: string) => {
    onChange({ preset: 'CUSTOM', from, to: value.to });
  };

  const handleToChange = (to: string) => {
    onChange({ preset: 'CUSTOM', from: value.from, to });
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="flex items-center gap-2 h-8 px-3 rounded-xl border text-xs font-semibold transition-colors bg-background/50 border-border/50 hover:border-primary/40 hover:bg-accent/50"
        >
          <CalendarRange className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="truncate">{triggerLabel}</span>
          <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          sideOffset={8}
          align="end"
          className={cn(
            'z-50 w-72 rounded-2xl border border-border/60 bg-popover text-popover-foreground shadow-2xl p-4 space-y-4 outline-none',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
            'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
          )}
        >
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-2">Quick Select</p>
            <div className="flex flex-wrap gap-1.5">
              {CONSUMPTION_PRESETS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => handlePreset(p.value)}
                  className={cn(
                    'px-2.5 py-1 text-[11px] font-semibold rounded-full border transition-all',
                    value.preset === p.value
                      ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                      : 'bg-card/40 text-muted-foreground border-border/50 hover:border-primary/40 hover:text-foreground',
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          {value.preset !== 'ALL_TIME' && (
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-2">Custom Range</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-[10px] uppercase font-bold text-muted-foreground">From</Label>
                  <Input
                    type="date"
                    value={value.from}
                    max={value.to || undefined}
                    onChange={(e) => handleFromChange(e.target.value)}
                    className="h-8 rounded-xl bg-background/50 border-border/50 text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[10px] uppercase font-bold text-muted-foreground">To</Label>
                  <Input
                    type="date"
                    value={value.to}
                    min={value.from || undefined}
                    onChange={(e) => handleToChange(e.target.value)}
                    className="h-8 rounded-xl bg-background/50 border-border/50 text-xs"
                  />
                </div>
              </div>
            </div>
          )}
          <Button size="sm" className="w-full rounded-xl text-xs font-bold" onClick={() => setOpen(false)}>
            Apply
          </Button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

interface CustomerDetailProps {
  customerId: string;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_LABELS: Record<number, string> = { 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat' };

export function CustomerDetail({ customerId }: CustomerDetailProps) {
  const router = useRouter();
  const { data, isLoading } = useCustomer(customerId);
  const { mutate: removeAccount, isPending: isRemovingAccount } = useRemovePortalAccount();

  const [editOpen, setEditOpen] = useState(false);
  const [portalOpen, setPortalOpen] = useState(false);
  const [customPriceOpen, setCustomPriceOpen] = useState(false);
  const [locationOpen, setLocationOpen] = useState(false);
  const [consumptionRange, setConsumptionRange] = useState<ConsumptionRange>(() => {
    const today = new Date();
    const from = new Date(today);
    from.setDate(from.getDate() - 29);
    return { preset: 'LAST_30', from: toIso(from), to: toIso(today) };
  });
  const [scheduleRange, setScheduleRange] = useState<{ dateFrom: string; dateTo: string }>(() => {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
    return { dateFrom: from, dateTo: to };
  });

  const { mutate: removeCustomPrice, isPending: isRemovingPrice } = useRemoveCustomPrice();
  const [removeCustomPriceId, setRemoveCustomPriceId] = useState<string | null>(null);
  const { data: consumptionData, isLoading: isLoadingConsumption } = useCustomerConsumption(
    customerId,
    consumptionRange.preset === 'ALL_TIME'
      ? { allTime: true }
      : { from: consumptionRange.from, to: consumptionRange.to },
  );
  const { data: scheduleData, isLoading: isLoadingSchedule } = useCustomerSchedule(customerId, scheduleRange);

  // Derive a YYYY-MM month from the range end for the statement endpoint
  const statementMonth = (
    consumptionRange.preset === 'ALL_TIME'
      ? new Date().toISOString()
      : consumptionRange.to + 'T00:00:00Z'
  ).slice(0, 7);

  const handleStatementDownload = async () => {
    try {
      const res = await customersApi.getStatement(customerId, { month: statementMonth });
      const blob = res.data as Blob;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `statement-${customerId}-${statementMonth}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      const { toast } = await import('sonner');
      toast.error('Statement not available for this period');
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-20 bg-muted/30 rounded-3xl w-1/3" />
        <div className="grid gap-4 md:grid-cols-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-32 rounded-3xl" />)}
        </div>
        <Skeleton className="h-[400px] rounded-3xl" />
      </div>
    );
  }

  const customer = data as CustomerDetailType;
  const balance = Number(customer?.financialBalance ?? 0);
  const isNegative = balance > 0; // Customer owes money

  return (
    <div className="space-y-8 pb-10">
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <Button 
          variant="ghost" 
          size="icon" 
          onClick={() => router.back()}
          className="rounded-full hover:bg-accent group transition-all"
        >
          <ArrowLeft className="h-5 w-5 group-hover:-translate-x-1 transition-transform" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight">{customer.name}</h1>
            <Badge variant="outline" className="font-mono text-[10px] tracking-tighter uppercase px-2 py-0">
              {customer.customerCode}
            </Badge>
          </div>
          <p className="text-muted-foreground flex items-center gap-2 mt-1">
            <Phone className="h-3 w-3" /> {customer.phoneNumber}
          </p>
        </div>
        <Button 
          onClick={() => setEditOpen(true)}
          className="rounded-full flex items-center gap-2 font-bold shadow-lg shadow-primary/20"
        >
          <Pencil className="h-4 w-4" />
          Edit Profile
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="bg-card/50 backdrop-blur-sm border-border/50 hover:border-primary/20 transition-all">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
              <Wallet className="h-3 w-3" /> Wallet Balance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={cn(
              "text-2xl font-black font-mono",
              isNegative ? "text-destructive" : "text-emerald-500"
            )}>
              ₨ {balance.toLocaleString()}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1 font-medium">
              {isNegative ? 'Outstanding Payment' : 'Account Balance Cleared'}
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card/50 backdrop-blur-sm border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
              <MapPin className="h-3 w-3" /> Route
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold truncate">
              {customer.route?.name || 'Unassigned'}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1 font-medium">Primary Delivery Route</p>
          </CardContent>
        </Card>

        <Card className="bg-card/50 backdrop-blur-sm border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
              <Calendar className="h-3 w-3" /> Schedule
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-1">
              {customer.deliverySchedules?.length > 0 ? (
                customer.deliverySchedules.map((s) => (
                  <div key={s.id ?? s.dayOfWeek} className="flex items-center gap-1.5">
                    <Badge variant="secondary" className="text-[9px] font-black px-1.5 py-0 bg-primary/5 text-primary border-primary/20">
                      {DAY_LABELS[s.dayOfWeek] ?? DAYS[s.dayOfWeek]}
                    </Badge>
                    <span className="text-[9px] text-muted-foreground font-medium">{s.van?.plateNumber}</span>
                  </div>
                ))
              ) : (
                <span className="text-sm font-bold text-muted-foreground">Not Set</span>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground mt-2 font-medium">Weekly Delivery Schedule</p>
          </CardContent>
        </Card>

        <Card className="bg-card/50 backdrop-blur-sm border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
              <Clock className="h-3 w-3" /> Member Since
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold">
              {new Date(customer.createdAt).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1 font-medium">Customer Onboarding Date</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="transactions" className="w-full">
        <TabsList className="bg-accent/30 p-1 rounded-2xl border border-border/50 flex-wrap h-auto gap-1">
          <TabsTrigger value="transactions" className="rounded-xl font-bold px-5 py-2 transition-all">
            Transactions
          </TabsTrigger>
          <TabsTrigger value="inventory" className="rounded-xl font-bold px-5 py-2 transition-all">
            Inventory & Wallets
          </TabsTrigger>
          <TabsTrigger value="consumption" className="rounded-xl font-bold px-5 py-2 transition-all">
            Consumption
          </TabsTrigger>
          <TabsTrigger value="schedule" className="rounded-xl font-bold px-5 py-2 transition-all">
            Schedule
          </TabsTrigger>
          <TabsTrigger value="prices" className="rounded-xl font-bold px-5 py-2 transition-all">
            Custom Pricing
          </TabsTrigger>
          <TabsTrigger value="info" className="rounded-xl font-bold px-5 py-2 transition-all">
            Full Info
          </TabsTrigger>
        </TabsList>
        
        <div className="mt-6 animate-in fade-in duration-500">
          <TabsContent value="transactions">
            <Card className="rounded-3xl border-border/50 bg-card/30 backdrop-blur-sm overflow-hidden">
              <CardContent className="p-6">
                <TransactionList customerId={customerId} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="inventory">
            <div className="grid gap-6 md:grid-cols-2">
              <Card className="rounded-3xl border-border/50 bg-card/30 backdrop-blur-sm">
                <CardHeader className="border-b bg-muted/20 px-6 py-4">
                  <CardTitle className="text-base font-bold flex items-center gap-2">
                    <Droplets className="h-4 w-4 text-primary" /> Bottle Wallets
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  {customer.wallets?.length > 0 ? (
                    <div className="divide-y divide-border/50">
                      {customer.wallets.map((w) => (
                        <div key={w.id} className="flex items-center justify-between p-4 hover:bg-accent/30 transition-colors">
                          <div className="flex flex-col">
                            <span className="text-sm font-bold">{w.product?.name}</span>
                            <span className="text-[10px] text-muted-foreground">Product Inventory</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-2xl font-black font-mono">{w.balance}</span>
                            <span className="text-[10px] font-bold uppercase text-muted-foreground">Units</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-10 text-center text-muted-foreground">No bottle wallets found.</div>
                  )}
                </CardContent>
              </Card>

              <Card className="rounded-3xl border-border/50 bg-card/30 backdrop-blur-sm flex flex-col items-center justify-center p-8 text-center border-dashed border-2">
                <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center text-primary mb-4">
                  <CreditCard className="h-6 w-6" />
                </div>
                <h3 className="font-bold">Total Assets</h3>
                <p className="text-sm text-muted-foreground mt-1 max-w-[200px]">
                  View all bottles and assets currently assigned to this customer across all products.
                </p>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="consumption">
            <Card className="rounded-3xl border-border/50 bg-card/30 backdrop-blur-sm">
              <CardHeader className="border-b bg-muted/20 px-6 py-4 flex flex-row items-center justify-between gap-3 flex-wrap">
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-primary" /> Consumption Rate
                </CardTitle>
                <div className="flex items-center gap-2 flex-wrap">
                  <ConsumptionRangePicker value={consumptionRange} onChange={setConsumptionRange} />
                  <Button size="sm" variant="outline" className="rounded-xl h-8 px-3 text-xs font-bold gap-1.5" onClick={handleStatementDownload}>
                    <FileText className="h-3.5 w-3.5" /> Statement PDF
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-6">
                {isLoadingConsumption ? (
                  <div className="grid gap-4 sm:grid-cols-3">
                    {[1, 2, 3, 4, 5, 6].map(i => <div key={i} className="h-24 bg-muted/30 rounded-2xl animate-pulse" />)}
                  </div>
                ) : (() => {
                  const c = consumptionData as CustomerConsumption | undefined;
                  if (!c) return <p className="text-sm text-muted-foreground text-center py-10">No data</p>;
                  const { summary, byProduct, trend } = c;

                  // Trend chip helpers
                  const showTrend = trend != null && trend.changePct != null;
                  const trendPositive = (trend?.changePct ?? 0) >= 0;

                  // Rate badge styling by status
                  const rateBadgeClass = (status: string | null | undefined): string => {
                    if (status === 'ON_TARGET') return 'bg-emerald-500/15 text-emerald-600 border-emerald-500/20';
                    if (status === 'ATTENTION') return 'bg-amber-500/15 text-amber-600 border-amber-500/20';
                    if (status === 'ACTION') return 'bg-red-500/15 text-red-600 border-red-500/20';
                    return 'bg-muted/40 text-muted-foreground border-border/50';
                  };

                  return (
                    <div className="space-y-6">
                      {/* Summary stats — 6 cards */}
                      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
                        {[
                          { label: 'Deliveries', value: String(summary?.deliveryCount ?? 0) },
                          { label: 'Total Filled', value: String(summary?.totalFilledDropped ?? 0) },
                          { label: 'Empties Returned', value: String(summary?.totalEmptyReceived ?? 0) },
                          { label: 'Avg / Delivery', value: Number(summary?.avgFilledPerDelivery ?? 0).toFixed(1) },
                          { label: 'Bottles / Day', value: Number(summary?.bottlesPerDay ?? 0).toFixed(2) },
                          {
                            label: 'Avg Gap',
                            value: summary?.avgDaysBetweenDeliveries != null
                              ? `${Number(summary.avgDaysBetweenDeliveries).toFixed(1)}d`
                              : '—',
                          },
                        ].map((s) => (
                          <div key={s.label} className="rounded-2xl bg-muted/30 p-4 text-center">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{s.label}</p>
                            <p className="text-2xl font-black mt-1">{s.value}</p>
                          </div>
                        ))}
                      </div>

                      {/* Trend chip */}
                      {showTrend && (
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              'inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold border',
                              trendPositive
                                ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'
                                : 'bg-red-500/10 text-red-600 border-red-500/20',
                            )}
                          >
                            {trendPositive
                              ? <TrendingUp className="h-3.5 w-3.5" />
                              : <TrendingDown className="h-3.5 w-3.5" />}
                            {trendPositive ? '+' : ''}{Number(trend!.changePct).toFixed(1)}% vs previous period
                          </span>
                        </div>
                      )}

                      {/* Per-product breakdown */}
                      {(byProduct ?? []).length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-6">No deliveries in this period</p>
                      ) : (
                        <div className="space-y-2">
                          <div className="divide-y divide-border/50 border border-border/50 rounded-2xl overflow-hidden">
                            <div className="grid grid-cols-7 px-4 py-2 bg-muted/20 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                              <span>Product</span>
                              <span className="text-right">Deliveries</span>
                              <span className="text-right">Total Consumed</span>
                              <span className="text-right">Avg/Delivery</span>
                              <span className="text-right">Bottles/Day</span>
                              <span className="text-right">Stock Left</span>
                              <span className="text-right">Rate</span>
                            </div>
                            {(byProduct ?? []).map((p) => (
                              <div key={p.product?.id} className="grid grid-cols-7 px-4 py-3 hover:bg-accent/20 transition-colors items-center">
                                <span className="text-sm font-bold">{p.product?.name}</span>
                                <span className="text-sm font-mono text-right">{p.deliveryCount}</span>
                                <span className="text-sm font-mono text-right">{p.totalConsumed}</span>
                                <span className="text-sm font-mono text-right">{p.avgPerDelivery}</span>
                                <span className="text-sm font-mono text-right">{Number(p.bottlesPerDay ?? 0).toFixed(2)}</span>
                                <span className="text-sm font-mono text-right">
                                  {p.estStockDaysLeft != null ? `${p.estStockDaysLeft}d` : '—'}
                                </span>
                                <div className="flex justify-end">
                                  <span
                                    className={cn(
                                      'text-[10px] font-bold px-2 py-0.5 rounded-full border',
                                      rateBadgeClass(p.rateStatus),
                                    )}
                                  >
                                    {p.consumptionRate}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                          <p className="text-[10px] text-muted-foreground px-1">
                            Target: 80% · 70–90% on target · &lt;50% overstocked · &gt;100% running dry
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="schedule">
            <Card className="rounded-3xl border-border/50 bg-card/30 backdrop-blur-sm">
              <CardHeader className="border-b bg-muted/20 px-6 py-4 flex flex-row items-center justify-between">
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-primary" /> Delivery Schedule
                </CardTitle>
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={scheduleRange.dateFrom}
                    onChange={(e) => setScheduleRange((p) => ({ ...p, dateFrom: e.target.value }))}
                    className="h-8 px-2 rounded-lg border border-border/50 bg-background text-xs font-medium focus:outline-none focus:ring-1 focus:ring-primary/50"
                  />
                  <span className="text-xs text-muted-foreground">to</span>
                  <input
                    type="date"
                    value={scheduleRange.dateTo}
                    onChange={(e) => setScheduleRange((p) => ({ ...p, dateTo: e.target.value }))}
                    className="h-8 px-2 rounded-lg border border-border/50 bg-background text-xs font-medium focus:outline-none focus:ring-1 focus:ring-primary/50"
                  />
                </div>
              </CardHeader>
              <CardContent className="p-6">
                {isLoadingSchedule ? (
                  <div className="space-y-3">
                    {[1, 2, 3].map((i) => <div key={i} className="h-14 bg-muted/30 rounded-2xl animate-pulse" />)}
                  </div>
                ) : (() => {
                  const items = (scheduleData as CustomerScheduleItem[]) ?? [];
                  if (items.length === 0) {
                    return <p className="text-sm text-muted-foreground text-center py-10">No scheduled deliveries in this date range.</p>;
                  }
                  const STATUS_COLORS: Record<string, string> = {
                    COMPLETED: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
                    EMPTY_ONLY: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
                    PENDING: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
                    RESCHEDULED: 'bg-orange-500/10 text-orange-600 border-orange-500/20',
                    CANCELLED: 'bg-destructive/10 text-destructive border-destructive/20',
                    NOT_AVAILABLE: 'bg-destructive/10 text-destructive border-destructive/20',
                  };
                  return (
                    <div className="divide-y divide-border/50 border border-border/50 rounded-2xl overflow-hidden">
                      <div className="grid grid-cols-4 px-4 py-2 bg-muted/20 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                        <span>Date</span><span>Product</span><span className="text-right">Qty</span><span className="text-right">Status</span>
                      </div>
                      {items.map((item) => (
                        <div key={item.id} className="grid grid-cols-4 px-4 py-3 hover:bg-accent/20 transition-colors items-center">
                          <span className="text-xs font-semibold">
                            {new Date(item.date ?? item.dailySheet?.date ?? '').toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                          </span>
                          <span className="text-xs font-semibold">{item.product?.name ?? '—'}</span>
                          <span className="text-xs font-mono text-right">{item.filledDropped ?? 0}</span>
                          <div className="flex justify-end">
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${STATUS_COLORS[item.status] ?? 'bg-muted text-muted-foreground border-muted'}`}>
                              {item.status}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="prices">
            <Card className="rounded-3xl border-border/50 bg-card/30 backdrop-blur-sm">
              <CardHeader className="border-b bg-muted/20 px-6 py-4 flex flex-row items-center justify-between">
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <Tag className="h-4 w-4 text-primary" /> Custom Product Pricing
                </CardTitle>
                <Button variant="outline" size="sm" className="rounded-full h-8 px-4 text-xs font-bold" onClick={() => setCustomPriceOpen(true)}>
                  Add Custom Rate
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                {customer.customPrices?.length > 0 ? (
                  <div className="divide-y divide-border/50">
                    {customer.customPrices.map((p) => (
                      <div key={p.id} className="flex items-center justify-between p-4 hover:bg-accent/30 transition-colors">
                        <div className="flex flex-col">
                          <span className="text-sm font-bold">{p.product?.name}</span>
                          <span className="text-[10px] text-muted-foreground">Standard Base: ₨ {p.product?.basePrice}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="flex flex-col items-end">
                            <span className="text-lg font-black font-mono text-primary">₨ {p.customPrice}</span>
                            <span className="text-[10px] font-bold uppercase text-emerald-500">Special Rate</span>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 rounded-full hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => setRemoveCustomPriceId(p.productId)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-10 text-center text-muted-foreground flex flex-col items-center gap-2">
                    <Info className="h-5 w-5 opacity-20" />
                    <p className="text-sm font-medium">Using standard base pricing for all products.</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="info">
            <div className="grid gap-6 md:grid-cols-3">
              <div className="md:col-span-2 space-y-6">
                <Card className="rounded-3xl border-border/50 bg-card/30 backdrop-blur-sm">
                  <CardHeader className="border-b bg-muted/20 px-6 py-4">
                    <CardTitle className="text-base font-bold flex items-center gap-2">
                      <User className="h-4 w-4 text-primary" /> Account Information
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-6">
                    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                      <div className="space-y-1">
                        <dt className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">Full Name</dt>
                        <dd className="text-sm font-bold">{customer.name}</dd>
                      </div>
                      <div className="space-y-1">
                        <dt className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">Customer Code</dt>
                        <dd className="text-sm font-bold font-mono">{customer.customerCode}</dd>
                      </div>
                      <div className="space-y-1">
                        <dt className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">Phone Number</dt>
                        <dd className="text-sm font-bold">{customer.phoneNumber}</dd>
                      </div>
                      <div className="space-y-1">
                        <dt className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">Primary Address</dt>
                        <dd className="text-sm font-bold">{customer.address}</dd>
                      </div>
                    </dl>
                  </CardContent>
                </Card>

                {/* Portal Access Card */}
                <Card className="rounded-3xl border-border/50 bg-card/30 backdrop-blur-sm overflow-hidden">
                  <CardHeader className="border-b bg-muted/20 px-6 py-4 flex flex-row items-center justify-between">
                    <CardTitle className="text-base font-bold flex items-center gap-2">
                      <Globe className="h-4 w-4 text-primary" /> Portal Access
                    </CardTitle>
                    {customer.user ? (
                      <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 font-bold uppercase text-[9px]">Active</Badge>
                    ) : (
                      <Badge variant="secondary" className="font-bold uppercase text-[9px]">Disabled</Badge>
                    )}
                  </CardHeader>
                  <CardContent className="p-6">
                    {customer.user ? (
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                              <ShieldCheck className="h-5 w-5" />
                            </div>
                            <div>
                              <p className="text-xs font-bold">{customer.user.email}</p>
                              <p className="text-[10px] text-muted-foreground font-medium uppercase">Portal Account Link</p>
                            </div>
                          </div>
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            className="text-destructive hover:bg-destructive/10 rounded-xl font-bold gap-2"
                            onClick={() => removeAccount(customerId)}
                            disabled={isRemovingAccount}
                          >
                            <Trash2 className="h-4 w-4" /> Revoke Access
                          </Button>
                        </div>
                        <div className="p-3 rounded-xl bg-accent/30 border border-border/50 flex items-start gap-3">
                          <Info className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                          <p className="text-[10px] text-muted-foreground leading-relaxed font-medium">
                            Customer can now login to the portal using their <span className="font-bold text-foreground">Email</span> or <span className="font-bold text-foreground">Phone Number</span>.
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center py-4 text-center space-y-4">
                        <div className="h-12 w-12 rounded-2xl bg-muted flex items-center justify-center">
                          <LockIcon className="h-6 w-6 text-muted-foreground opacity-50" />
                        </div>
                        <div className="space-y-1">
                          <h4 className="text-sm font-bold">No Portal Access</h4>
                          <p className="text-xs text-muted-foreground max-w-[250px]">Create an account to allow the customer to view their ledger and make payments online.</p>
                        </div>
                        <Button 
                          onClick={() => setPortalOpen(true)}
                          className="rounded-xl font-bold shadow-lg shadow-primary/20"
                        >
                          Enable Portal Access
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              <Card className="rounded-3xl border-border/50 bg-card/30 backdrop-blur-sm overflow-hidden flex flex-col">
                <CardHeader className="border-b bg-muted/20 px-6 py-4">
                  <div className="flex items-center justify-between w-full">
                    <CardTitle className="text-base font-bold flex items-center gap-2">
                      <Navigation className="h-4 w-4 text-primary" /> Location
                    </CardTitle>
                    <Button
                      size="sm"
                      variant="outline"
                      className="rounded-xl h-8 text-xs font-bold"
                      onClick={() => setLocationOpen(true)}
                    >
                      <Pencil className="h-3 w-3 mr-1" />
                      {customer.latitude && customer.longitude ? 'Edit Location' : 'Add Location'}
                    </Button>
                  </div>
                </CardHeader>

                {/* Embedded OpenStreetMap — shown only when lat/lng available */}
                {customer.latitude && customer.longitude ? (
                  <div className="relative w-full h-48 border-b border-border/50 overflow-hidden">
                    <iframe
                      title="Customer Location"
                      width="100%"
                      height="100%"
                      loading="lazy"
                      src={`https://maps.google.com/maps?q=${customer.latitude},${customer.longitude}&z=17&output=embed`}
                      className="border-none w-full h-full"
                    />
                    {/* Overlay click → open full map */}
                    <a
                      href={customer.googleMapsUrl || `https://www.google.com/maps?q=${customer.latitude},${customer.longitude}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="absolute top-2 right-2 flex items-center gap-1.5 bg-background/90 backdrop-blur-sm border border-border/50 rounded-xl px-2.5 py-1.5 text-[10px] font-bold text-foreground hover:bg-primary/10 hover:text-primary hover:border-primary/30 transition-all shadow-lg"
                    >
                      <ExternalLink className="h-3 w-3" /> Open Maps
                    </a>
                  </div>
                ) : (
                  /* No coordinates — show placeholder with map icon */
                  <div className="h-32 bg-accent/10 border-b border-border/50 flex flex-col items-center justify-center gap-2">
                    <MapPin className="h-7 w-7 text-muted-foreground/30" />
                    <p className="text-[10px] text-muted-foreground/50 font-semibold">No coordinates — add Google Maps link to enable map</p>
                  </div>
                )}

                <CardContent className="p-5 space-y-3">
                  {/* Address */}
                  <div className="flex items-start gap-2.5">
                    <MapPin className="h-3.5 w-3.5 text-primary shrink-0 mt-1" />
                    <p className="text-sm font-semibold leading-snug">{customer.address}</p>
                  </div>

                  {/* Floor + Landmark row */}
                  {(customer.floor || customer.nearbyLandmark) && (
                    <div className="flex flex-wrap gap-2">
                      {customer.floor && (
                        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-accent/40 border border-border/30">
                          <Building2 className="h-3 w-3 text-muted-foreground" />
                          <span className="text-xs font-semibold">{customer.floor}</span>
                        </div>
                      )}
                      {customer.nearbyLandmark && (
                        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-accent/40 border border-border/30">
                          <Landmark className="h-3 w-3 text-muted-foreground" />
                          <span className="text-xs font-semibold">{customer.nearbyLandmark}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Delivery instructions */}
                  {customer.deliveryInstructions && (
                    <div className="p-2.5 rounded-xl bg-amber-500/5 border border-amber-500/20 flex items-start gap-2">
                      <Info className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
                      <p className="text-xs text-foreground/80 leading-relaxed">{customer.deliveryInstructions}</p>
                    </div>
                  )}

                  {/* Coordinates badge */}
                  {customer.latitude && customer.longitude && (
                    <Badge variant="secondary" className="font-mono text-[10px] font-bold">
                      {Number(customer.latitude).toFixed(5)}, {Number(customer.longitude).toFixed(5)}
                    </Badge>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </div>
      </Tabs>

      <EditLocationDialog
        open={locationOpen}
        onClose={() => setLocationOpen(false)}
        customerId={customerId}
        latitude={customer.latitude ?? null}
        longitude={customer.longitude ?? null}
        currentAddress={customer.address ?? ''}
      />

      <PortalAccountDialog
        open={portalOpen}
        onClose={() => setPortalOpen(false)}
        customerId={customerId}
      />

      <CustomPriceDialog
        open={customPriceOpen}
        onClose={() => setCustomPriceOpen(false)}
        customerId={customerId}
      />

      <CustomerForm
        open={editOpen}
        onOpenChange={setEditOpen}
        customer={customer as unknown as Record<string, unknown>}
      />

      <ConfirmDialog
        open={!!removeCustomPriceId}
        onOpenChange={(o) => { if (!o) setRemoveCustomPriceId(null); }}
        title="Remove Custom Price"
        description="Remove the custom price for this product? The customer will revert to the standard base price."
        onConfirm={() => { if (removeCustomPriceId) { removeCustomPrice({ customerId, productId: removeCustomPriceId }, { onSuccess: () => setRemoveCustomPriceId(null) }); } }}
        isLoading={isRemovingPrice}
        confirmLabel="Remove Price"
      />
    </div>
  );
}
