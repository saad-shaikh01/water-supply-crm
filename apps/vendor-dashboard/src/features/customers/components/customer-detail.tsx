'use client';

import { useState } from 'react';
import { 
  Tabs, TabsContent, TabsList, TabsTrigger, 
  Card, CardContent, CardHeader, CardTitle, 
  Skeleton, Button, Badge, Separator,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Input, Label
} from '@water-supply-crm/ui';
import {
  useCustomer,
  useCreatePortalAccount,
  useRemovePortalAccount,
  useCustomerConsumption,
  useSetCustomPrice,
  useRemoveCustomPrice,
  useCustomerSchedule,
} from '../hooks/use-customers';
import { useProducts } from '../../products/hooks/use-products';
import { PageHeader } from '../../../components/shared/page-header';
import { TransactionList } from '../../transactions/components/transaction-list';
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import {
  MapPin, Phone, User, Calendar,
  Wallet, Tag, ArrowLeft, Pencil,
  CreditCard, Droplets, Clock, Info,
  ShieldCheck, Lock, Mail, Trash2, Globe,
  TrendingUp, FileText, ChevronLeft, ChevronRight,
  ExternalLink, Navigation, Building2, Landmark,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@water-supply-crm/ui';
import { CustomerForm } from './customer-form';

interface CustomerDetailProps {
  customerId: string;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_LABELS: Record<number, string> = { 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat' };

export function CustomerDetail({ customerId }: CustomerDetailProps) {
  const router = useRouter();
  const { data, isLoading } = useCustomer(customerId);
  const { mutate: createAccount, isPending: isCreatingAccount } = useCreatePortalAccount();
  const { mutate: removeAccount, isPending: isRemovingAccount } = useRemovePortalAccount();

  const [editOpen, setEditOpen] = useState(false);
  const [portalOpen, setPortalOpen] = useState(false);
  const [portalData, setPortalData] = useState({ email: '', password: '' });
  const [customPriceOpen, setCustomPriceOpen] = useState(false);
  const [customPriceForm, setCustomPriceForm] = useState({ productId: '', customPrice: '' });
  const [consumptionMonth, setConsumptionMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [scheduleRange, setScheduleRange] = useState<{ dateFrom: string; dateTo: string }>(() => {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
    return { dateFrom: from, dateTo: to };
  });

  const { mutate: setCustomPrice, isPending: isSavingPrice } = useSetCustomPrice();
  const { mutate: removeCustomPrice } = useRemoveCustomPrice();
  const { data: consumptionData, isLoading: isLoadingConsumption } = useCustomerConsumption(customerId, consumptionMonth);
  const { data: scheduleData, isLoading: isLoadingSchedule } = useCustomerSchedule(customerId, scheduleRange);
  const { data: productsData } = useProducts();
  const allProducts = (productsData as any)?.data ?? [];

  const handleStatementDownload = async () => {
    try {
      const { default: axios } = await import('axios');
      const { getCookie } = await import('cookies-next');
      const token = getCookie('auth_token');
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000/api';
      const res = await axios.get(`${apiUrl}/customers/${customerId}/statement?month=${consumptionMonth}`, {
        responseType: 'blob',
        headers: { Authorization: `Bearer ${token}` },
      });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `statement-${customerId}-${consumptionMonth}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // silent — no toast needed if statement not available
    }
  };

  const handleMonthChange = (dir: -1 | 1) => {
    const d = new Date(consumptionMonth + '-01');
    d.setMonth(d.getMonth() + dir);
    setConsumptionMonth(d.toISOString().slice(0, 7));
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

  const customer = (data ?? {}) as Record<string, any>;
  const balance = Number(customer.financialBalance ?? 0);
  const isNegative = balance > 0; // Customer owes money

  const handleCreateAccount = () => {
    createAccount({ id: customerId, data: portalData }, {
      onSuccess: () => {
        setPortalOpen(false);
        setPortalData({ email: '', password: '' });
      }
    });
  };

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
                customer.deliverySchedules.map((s: any) => (
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
                      {customer.wallets.map((w: any) => (
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
              <CardHeader className="border-b bg-muted/20 px-6 py-4 flex flex-row items-center justify-between">
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-primary" /> Consumption Rate
                </CardTitle>
                <div className="flex items-center gap-2">
                  <button onClick={() => handleMonthChange(-1)} className="h-7 w-7 rounded-lg border border-border/50 flex items-center justify-center hover:bg-accent transition-colors">
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </button>
                  <span className="text-xs font-bold min-w-[80px] text-center">{consumptionMonth}</span>
                  <button onClick={() => handleMonthChange(1)} className="h-7 w-7 rounded-lg border border-border/50 flex items-center justify-center hover:bg-accent transition-colors">
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                  <Button size="sm" variant="outline" className="rounded-xl h-8 px-3 text-xs font-bold gap-1.5 ml-2" onClick={handleStatementDownload}>
                    <FileText className="h-3.5 w-3.5" /> Statement PDF
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-6">
                {isLoadingConsumption ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    {[1, 2, 3, 4].map(i => <div key={i} className="h-24 bg-muted/30 rounded-2xl animate-pulse" />)}
                  </div>
                ) : (() => {
                  const c = consumptionData as any;
                  if (!c) return <p className="text-sm text-muted-foreground text-center py-10">No data</p>;
                  const { summary, byProduct } = c;
                  return (
                    <div className="space-y-6">
                      {/* Summary stats */}
                      <div className="grid gap-3 sm:grid-cols-4">
                        {[
                          { label: 'Deliveries', value: summary?.deliveryCount ?? 0 },
                          { label: 'Total Filled', value: summary?.totalFilledDropped ?? 0 },
                          { label: 'Total Empties Returned', value: summary?.totalEmptyReceived ?? 0 },
                          { label: 'Avg per Delivery', value: summary?.avgFilledPerDelivery ?? 0 },
                        ].map((s) => (
                          <div key={s.label} className="rounded-2xl bg-muted/30 p-4 text-center">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{s.label}</p>
                            <p className="text-2xl font-black mt-1">{s.value}</p>
                          </div>
                        ))}
                      </div>
                      {/* Per-product breakdown */}
                      {(byProduct ?? []).length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-6">No deliveries in this period</p>
                      ) : (
                        <div className="divide-y divide-border/50 border border-border/50 rounded-2xl overflow-hidden">
                          <div className="grid grid-cols-5 px-4 py-2 bg-muted/20 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                            <span>Product</span><span className="text-right">Deliveries</span><span className="text-right">Total Consumed</span><span className="text-right">Avg/Delivery</span><span className="text-right">Consumption Rate</span>
                          </div>
                          {(byProduct ?? []).map((p: any) => (
                            <div key={p.product?.id} className="grid grid-cols-5 px-4 py-3 hover:bg-accent/20 transition-colors items-center">
                              <span className="text-sm font-bold">{p.product?.name}</span>
                              <span className="text-sm font-mono text-right">{p.deliveryCount}</span>
                              <span className="text-sm font-mono text-right">{p.totalConsumed}</span>
                              <span className="text-sm font-mono text-right">{p.avgPerDelivery}</span>
                              <span className={`text-sm font-bold text-right ${p.consumptionRate === 'N/A' ? 'text-muted-foreground' : 'text-primary'}`}>{p.consumptionRate}</span>
                            </div>
                          ))}
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
                  const items = (scheduleData as any[]) ?? [];
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
                      {items.map((item: any) => (
                        <div key={item.id} className="grid grid-cols-4 px-4 py-3 hover:bg-accent/20 transition-colors items-center">
                          <span className="text-xs font-semibold">
                            {new Date(item.date ?? item.dailySheet?.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
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
                <Button variant="outline" size="sm" className="rounded-full h-8 px-4 text-xs font-bold" onClick={() => { setCustomPriceForm({ productId: '', customPrice: '' }); setCustomPriceOpen(true); }}>
                  Add Custom Rate
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                {customer.customPrices?.length > 0 ? (
                  <div className="divide-y divide-border/50">
                    {customer.customPrices.map((p: any) => (
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
                            onClick={() => removeCustomPrice({ customerId, productId: p.productId })}
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
                          <Lock className="h-6 w-6 text-muted-foreground opacity-50" />
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
                  <CardTitle className="text-base font-bold flex items-center gap-2">
                    <Navigation className="h-4 w-4 text-primary" /> Location
                  </CardTitle>
                </CardHeader>

                {/* Embedded OpenStreetMap — shown only when lat/lng available */}
                {customer.latitude && customer.longitude ? (
                  <div className="relative w-full h-48 border-b border-border/50 overflow-hidden">
                    <iframe
                      title="Customer Location"
                      width="100%"
                      height="100%"
                      loading="lazy"
                      src={`https://www.openstreetmap.org/export/embed.html?bbox=${Number(customer.longitude) - 0.006},${Number(customer.latitude) - 0.004},${Number(customer.longitude) + 0.006},${Number(customer.latitude) + 0.004}&layer=mapnik&marker=${customer.latitude},${customer.longitude}`}
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

      {/* Account Creation Dialog */}
      <Dialog open={portalOpen} onOpenChange={setPortalOpen}>
        <DialogContent className="rounded-3xl max-w-sm bg-background/95 backdrop-blur-xl border-border/50">
          <DialogHeader>
            <DialogTitle className="text-xl font-black flex items-center gap-2">
              <Globe className="h-6 w-6 text-primary" />
              Portal Setup
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground">Login Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input 
                  type="email" 
                  placeholder="customer@email.com" 
                  className="pl-9 h-11"
                  value={portalData.email}
                  onChange={e => setPortalData(p => ({ ...p, email: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground">Initial Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input 
                  type="password" 
                  placeholder="••••••••" 
                  className="pl-9 h-11"
                  value={portalData.password}
                  onChange={e => setPortalData(p => ({ ...p, password: e.target.value }))}
                />
              </div>
              <p className="text-[10px] text-muted-foreground font-medium">Minimum 8 characters recommended.</p>
            </div>
          </div>
          <DialogFooter className="gap-3 sm:gap-0 border-t pt-6 mt-2">
            <Button variant="ghost" onClick={() => setPortalOpen(false)} className="rounded-xl">Cancel</Button>
            <Button 
              onClick={handleCreateAccount} 
              disabled={isCreatingAccount || !portalData.email || !portalData.password}
              className="rounded-xl font-bold shadow-lg shadow-primary/20"
            >
              {isCreatingAccount ? 'Setting up...' : 'Enable Access'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Custom Price Dialog */}
      <Dialog open={customPriceOpen} onOpenChange={setCustomPriceOpen}>
        <DialogContent className="rounded-3xl max-w-sm bg-background/95 backdrop-blur-xl border-border/50">
          <DialogHeader>
            <DialogTitle className="text-xl font-black flex items-center gap-2">
              <Tag className="h-5 w-5 text-primary" /> Set Custom Price
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground">Product</Label>
              <select
                value={customPriceForm.productId}
                onChange={e => setCustomPriceForm(p => ({ ...p, productId: e.target.value }))}
                className="w-full h-11 rounded-xl border border-border/50 bg-background px-3 text-sm font-bold focus:outline-none focus:ring-1 focus:ring-primary/50"
              >
                <option value="">Select product...</option>
                {allProducts.map((pr: any) => (
                  <option key={pr.id} value={pr.id}>{pr.name} (Base: ₨{pr.basePrice})</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground">Custom Price (₨)</Label>
              <Input
                type="number"
                placeholder="0.00"
                className="h-11 font-mono font-bold"
                value={customPriceForm.customPrice}
                onChange={e => setCustomPriceForm(p => ({ ...p, customPrice: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter className="gap-3 border-t pt-6 mt-2">
            <Button variant="ghost" onClick={() => setCustomPriceOpen(false)} className="rounded-xl">Cancel</Button>
            <Button
              onClick={() => {
                setCustomPrice(
                  { customerId, data: { productId: customPriceForm.productId, price: Number(customPriceForm.customPrice) } },
                  { onSuccess: () => setCustomPriceOpen(false) }
                );
              }}
              disabled={isSavingPrice || !customPriceForm.productId || !customPriceForm.customPrice}
              className="rounded-xl font-bold shadow-lg shadow-primary/20"
            >
              {isSavingPrice ? 'Saving...' : 'Save Price'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CustomerForm
        open={editOpen}
        onOpenChange={setEditOpen}
        customer={customer}
      />
    </div>
  );
}
