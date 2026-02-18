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
  useRemovePortalAccount 
} from '../hooks/use-customers';
import { PageHeader } from '../../../components/shared/page-header';
import { TransactionList } from '../../transactions/components/transaction-list';
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import { 
  MapPin, Phone, User, Calendar, 
  Wallet, Tag, ArrowLeft, Pencil, 
  CreditCard, Droplets, Clock, Info,
  ShieldCheck, Lock, Mail, Trash2, Globe
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@water-supply-crm/ui';
import { CustomerForm } from './customer-form';

interface CustomerDetailProps {
  customerId: string;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function CustomerDetail({ customerId }: CustomerDetailProps) {
  const router = useRouter();
  const { data, isLoading } = useCustomer(customerId);
  const { mutate: createAccount, isPending: isCreatingAccount } = useCreatePortalAccount();
  const { mutate: removeAccount, isPending: isRemovingAccount } = useRemovePortalAccount();

  const [editOpen, setEditOpen] = useState(false);
  const [portalOpen, setPortalOpen] = useState(false);
  const [portalData, setPortalData] = useState({ email: '', password: '' });

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
            <div className="flex gap-1 flex-wrap">
              {customer.deliveryDays?.length > 0 ? (
                customer.deliveryDays.map((d: number) => (
                  <Badge key={d} variant="secondary" className="text-[9px] font-black px-1.5 py-0 bg-primary/5 text-primary border-primary/20">
                    {DAYS[d]}
                  </Badge>
                ))
              ) : (
                <span className="text-sm font-bold text-muted-foreground">Not Set</span>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground mt-2 font-medium">Weekly Delivery Days</p>
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
        <TabsList className="bg-accent/30 p-1 rounded-2xl border border-border/50">
          <TabsTrigger value="transactions" className="rounded-xl font-bold px-6 py-2 transition-all">
            Transactions
          </TabsTrigger>
          <TabsTrigger value="inventory" className="rounded-xl font-bold px-6 py-2 transition-all">
            Inventory & Wallets
          </TabsTrigger>
          <TabsTrigger value="prices" className="rounded-xl font-bold px-6 py-2 transition-all">
            Custom Pricing
          </TabsTrigger>
          <TabsTrigger value="info" className="rounded-xl font-bold px-6 py-2 transition-all">
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

          <TabsContent value="prices">
            <Card className="rounded-3xl border-border/50 bg-card/30 backdrop-blur-sm">
              <CardHeader className="border-b bg-muted/20 px-6 py-4 flex flex-row items-center justify-between">
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <Tag className="h-4 w-4 text-primary" /> Custom Product Pricing
                </CardTitle>
                <Button variant="outline" size="sm" className="rounded-full h-8 px-4 text-xs font-bold">
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
                        <div className="flex items-center gap-4">
                          <div className="flex flex-col items-end">
                            <span className="text-lg font-black font-mono text-primary">₨ {p.customPrice}</span>
                            <span className="text-[10px] font-bold uppercase text-emerald-500">Special Rate</span>
                          </div>
                          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full">
                            <Pencil className="h-3 w-3" />
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
                 <div className="flex-1 bg-accent/20 flex flex-col items-center justify-center p-6 text-center border-b border-border/50 border-dashed">
                    <MapPin className="h-8 w-8 text-primary/40 mb-3" />
                    <p className="text-xs font-bold text-muted-foreground">Location Pin</p>
                    <p className="text-[10px] text-muted-foreground/60 max-w-[150px] mt-1 italic">Maps integration pending latitude/longitude verification.</p>
                 </div>
                 <div className="p-4 bg-muted/10">
                    <Button variant="outline" className="w-full rounded-xl text-xs font-bold border-dashed h-9">
                       Update Map Location
                    </Button>
                 </div>
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

      <CustomerForm
        open={editOpen}
        onOpenChange={setEditOpen}
        customer={customer}
      />
    </div>
  );
}
