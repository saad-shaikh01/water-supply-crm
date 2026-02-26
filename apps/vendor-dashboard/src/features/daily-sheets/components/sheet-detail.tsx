'use client';

import { useState } from 'react';
import {
  Card, CardContent, Button, Skeleton, Badge,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  Tabs, TabsList, TabsTrigger,
} from '@water-supply-crm/ui';
import { StatusBadge } from '../../../components/shared/status-badge';
import {
  useDailySheet, useCloseSheet, useUpdateDeliveryItem,
  useSwapAssignment, useCreateLoad, useCheckinLoad,
} from '../hooks/use-daily-sheets';
import { useAllVans } from '../../vans/hooks/use-vans';
import { useAllDrivers } from '../../users/hooks/use-users';
import { dailySheetsApi } from '../api/daily-sheets.api';
import { toast } from 'sonner';
import {
  Truck, Package, CheckCircle2, ClipboardList,
  ArrowLeft, Download, MapPin, User, ArrowRightLeft,
  Droplets, DollarSign, AlertCircle, Plus,
  ChevronDown, ChevronUp, Loader2, Clock,
  Phone, MessageCircle, Navigation, Printer,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { cn } from '@water-supply-crm/ui';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuthStore } from '../../../store/auth.store';
import { hasMinRole } from '../../../lib/rbac';

interface CustomerWallet {
  balance: number;
  product: { name: string };
  productId?: string;
}

interface DeliveryItem {
  id: string;
  sequence: number;
  customerId: string;
  customer?: {
    name: string;
    address: string;
    customerCode: string;
    floor?: string;
    nearbyLandmark?: string;
    deliveryInstructions?: string;
    latitude?: number;
    longitude?: number;
    phoneNumber?: string;
    paymentType?: 'MONTHLY' | 'CASH';
    financialBalance?: number;
    wallets?: CustomerWallet[];
  };
  productId: string;
  product?: { name: string };
  status: 'PENDING' | 'COMPLETED' | 'EMPTY_ONLY' | 'NOT_AVAILABLE' | 'RESCHEDULED' | 'CANCELLED';
  filledDropped: number;
  emptyReceived: number;
  cashCollected: number;
  reason?: string;
  failureCategory?: string;
  photoUrl?: string;
}

interface LoadTrip {
  id: string;
  tripNumber: number;
  loadedFilled: number;
  returnedFilled: number;
  collectedEmpty: number;
  cashHandedIn: number;
  startedAt: string;
  endedAt: string | null;
}

interface SheetDetailProps {
  sheetId: string;
}

type TabKey = 'all' | 'pending' | 'completed' | 'issues';

const ITEMS_PER_PAGE = 20;

function tabFilter(tab: TabKey, item: DeliveryItem): boolean {
  switch (tab) {
    case 'pending': return item.status === 'PENDING';
    case 'completed': return item.status === 'COMPLETED' || item.status === 'EMPTY_ONLY';
    case 'issues': return item.status === 'RESCHEDULED' || item.status === 'CANCELLED' || item.status === 'NOT_AVAILABLE';
    default: return true;
  }
}

export function SheetDetail({ sheetId }: SheetDetailProps) {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const isDriver = user?.role === 'DRIVER';
  const isAdminOrStaff = user ? hasMinRole(user.role, 'STAFF') : false;
  const isAdmin = user ? hasMinRole(user.role, 'VENDOR_ADMIN') : false;

  const { data, isLoading } = useDailySheet(sheetId);
  const { mutate: closeSheet, isPending: isClosing } = useCloseSheet(sheetId);
  const { mutate: updateItem, isPending: isUpdatingItem } = useUpdateDeliveryItem(sheetId);
  const { mutate: swapAssignment, isPending: isSwapping } = useSwapAssignment(sheetId);
  const { mutate: createLoad, isPending: isStartingTrip } = useCreateLoad(sheetId);
  const { mutate: checkinLoad, isPending: isCheckingIn } = useCheckinLoad(sheetId);
  const { data: vansData } = useAllVans();
  const allVans = ((vansData as any)?.data ?? []) as Array<{ id: string; plateNumber: string }>;
  const { data: driversData } = useAllDrivers();
  const allDrivers = ((driversData as any)?.data ?? []) as Array<{ id: string; name: string }>;

  // Dialog states
  const [newTripOpen, setNewTripOpen] = useState(false);
  const [checkinOpen, setCheckinOpen] = useState<string | null>(null);
  const [deliveryOpen, setDeliveryOpen] = useState<string | null>(null);
  const [swapOpen, setSwapOpen] = useState(false);
  const [reconcileOpen, setReconcileOpen] = useState(false);
  const [reconcileData, setReconcileData] = useState<any>(null);
  const [reconcileLoading, setReconcileLoading] = useState(false);

  // Form states
  const [newTripFilled, setNewTripFilled] = useState(0);
  const [checkinForm, setCheckinForm] = useState({ returnedFilled: 0, collectedEmpty: 0, cashHandedIn: 0 });
  const [itemForm, setItemForm] = useState<Partial<DeliveryItem>>({});
  const [swapForm, setSwapForm] = useState<{ vanId?: string; driverId?: string }>({});

  // Delivery dialog: two-step UX
  const [deliveryMode, setDeliveryMode] = useState<'delivered' | 'unable'>('delivered');
  const [failureCategory, setFailureCategory] = useState<string>('CUSTOMER_NOT_HOME');
  const [unableReason, setUnableReason] = useState('');

  const FAILURE_CATEGORIES = [
    { value: 'CUSTOMER_NOT_HOME', label: 'Customer Not Home' },
    { value: 'CUSTOMER_NOT_ANSWERING', label: 'Customer Not Answering' },
    { value: 'CUSTOMER_SELF_PICKUP', label: 'Customer Self Pickup' },
    { value: 'VAN_BREAKDOWN', label: 'Van Breakdown' },
    { value: 'ACCESS_ISSUE', label: 'Area / Access Issue' },
    { value: 'CUSTOMER_REFUSED', label: 'Customer Refused' },
    { value: 'WEATHER', label: 'Weather / Road Issue' },
    { value: 'OTHER', label: 'Other' },
  ] as const;

  const CATEGORY_LABELS: Record<string, string> = {
    CUSTOMER_NOT_HOME: 'Customer Not Home',
    CUSTOMER_NOT_ANSWERING: 'Customer Not Answering',
    CUSTOMER_SELF_PICKUP: 'Customer Self Pickup',
    VAN_BREAKDOWN: 'Van Breakdown',
    ACCESS_ISSUE: 'Area / Access Issue',
    CUSTOMER_REFUSED: 'Customer Refused',
    WEATHER: 'Weather / Road Issue',
    OTHER: 'Other',
  };

  const formatCategory = (cat: string) => CATEGORY_LABELS[cat] ?? cat;

  // Tabs + pagination
  const [activeTab, setActiveTab] = useState<TabKey>('all');
  const [tabPage, setTabPage] = useState(1);

  // Accordion
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);

  if (isLoading) return (
    <div className="space-y-6">
      <Skeleton className="h-20 w-full rounded-3xl" />
      <Skeleton className="h-96 w-full rounded-3xl" />
    </div>
  );

  const sheet = (data ?? {}) as Record<string, any>;
  const items = (sheet.items ?? []) as DeliveryItem[];
  const loads = (sheet.loads ?? []) as LoadTrip[];

  const activeTrip = loads.find((l) => !l.endedAt) ?? null;
  const hasAnyTrip = loads.length > 0;
  const isClosed = !!sheet.isClosed;
  const currentStatus = isClosed ? 'CLOSED' : activeTrip ? 'LOADED' : hasAnyTrip ? 'CHECKED_IN' : 'OPEN';

  // ── Computed real-time stats ────────────────────────────────────────
  const doneItems = items.filter((i) => i.status === 'COMPLETED' || i.status === 'EMPTY_ONLY');
  const totalFilledDropped = doneItems.reduce((acc, i) => acc + i.filledDropped, 0);
  const totalEmptyReceived = doneItems.reduce((acc, i) => acc + i.emptyReceived, 0);
  const totalCashCollected = doneItems.reduce((acc, i) => acc + i.cashCollected, 0);
  const bottlesInTruck = Math.max(0, (sheet.filledOutCount ?? 0) - totalFilledDropped);

  // ── Tab filtering + pagination ──────────────────────────────────────
  const filteredItems = items.filter((i) => tabFilter(activeTab, i));
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / ITEMS_PER_PAGE));
  const paginatedItems = filteredItems.slice((tabPage - 1) * ITEMS_PER_PAGE, tabPage * ITEMS_PER_PAGE);

  const tabCount = (tab: TabKey) => items.filter((i) => tabFilter(tab, i)).length;

  const handleTabChange = (tab: string) => {
    setActiveTab(tab as TabKey);
    setTabPage(1);
    setExpandedItemId(null);
  };

  // ── Delivery dialog handlers ─────────────────────────────────────────
  const handleOpenDelivery = (item: DeliveryItem) => {
    if (isClosed) return;
    const isUnable = item.status === 'RESCHEDULED' || item.status === 'CANCELLED' || item.status === 'NOT_AVAILABLE';
    setDeliveryMode(item.status === 'PENDING' ? 'delivered' : isUnable ? 'unable' : 'delivered');
    setFailureCategory(item.failureCategory || 'CUSTOMER_NOT_HOME');
    setUnableReason(item.reason || '');
    setItemForm({
      filledDropped: item.filledDropped || 1,
      emptyReceived: item.emptyReceived || 0,
      cashCollected: item.cashCollected || 0,
    });
    setDeliveryOpen(item.id);
  };

  const onSaveItem = () => {
    if (!deliveryOpen) return;
    let finalData: Record<string, unknown>;
    if (deliveryMode === 'delivered') {
      finalData = {
        status: 'COMPLETED',
        filledDropped: itemForm.filledDropped ?? 1,
        emptyReceived: itemForm.emptyReceived ?? 0,
        cashCollected: itemForm.cashCollected ?? 0,
      };
    } else {
      finalData = {
        status: 'NOT_AVAILABLE',
        failureCategory,
        filledDropped: 0,
        emptyReceived: 0,
        cashCollected: 0,
        reason: unableReason || undefined,
      };
    }
    updateItem({ itemId: deliveryOpen, data: finalData }, {
      onSuccess: () => {
        setDeliveryOpen(null);
        setExpandedItemId(null);
      },
    });
  };

  const handleExportPdf = async () => {
    try {
      const res = await dailySheetsApi.exportPdf(sheetId);
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sheet-${sheetId}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Failed to export PDF');
    }
  };

  const handlePrintInvoice = async () => {
    try {
      const res = await dailySheetsApi.exportInvoice(sheetId);
      const url = URL.createObjectURL(res.data);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      toast.error('Failed to load invoice');
    }
  };

  const handleOpenReconcile = async () => {
    setReconcileLoading(true);
    setReconcileData(null);
    setReconcileOpen(true);
    try {
      const data = await dailySheetsApi.getReconciliationPreview(sheetId);
      setReconcileData(data);
    } catch {
      toast.error('Failed to load reconciliation preview');
      setReconcileOpen(false);
    } finally {
      setReconcileLoading(false);
    }
  };

  const formatTime = (dt: string) =>
    new Date(dt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const formatPhone = (phone?: string) => {
    if (!phone) return '';
    return phone.startsWith('0') ? `92${phone.slice(1)}` : phone;
  };

  return (
    <div className="space-y-8 pb-20">
      {/* ── Header ─────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => router.back()} className="rounded-full">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-black tracking-tight">
              {new Date(sheet.date).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
            </h1>
            <StatusBadge status={currentStatus} />
          </div>
          <p className="text-muted-foreground text-sm flex items-center gap-2 mt-1 font-medium">
            <MapPin className="h-3 w-3" /> {sheet.route?.name ?? 'No Route'} • <Truck className="h-3 w-3 ml-1" /> {sheet.van?.plateNumber}
          </p>
        </div>
        <div className="flex gap-2">
          {!isClosed && isAdmin && (
            <Button
              variant="outline"
              size="icon"
              className="rounded-full"
              onClick={() => setSwapOpen(true)}
              title="Swap van assignment"
            >
              <ArrowRightLeft className="h-4 w-4" />
            </Button>
          )}
          {!isDriver && (
            <Button variant="outline" size="icon" className="rounded-full" onClick={handleExportPdf} title="Download PDF">
              <Download className="h-4 w-4" />
            </Button>
          )}
          <Button variant="outline" size="icon" className="rounded-full" onClick={handlePrintInvoice} title="Print Invoice">
            <Printer className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* ── Lifecycle Stepper ──────────────────────────────── */}
      <div className="grid grid-cols-4 gap-2">
        {[
          { label: 'Generated', active: true, icon: ClipboardList },
          { label: 'Loaded', active: hasAnyTrip || isClosed, icon: Package },
          { label: 'Checked In', active: (hasAnyTrip && !activeTrip) || isClosed, icon: DollarSign },
          { label: 'Closed', active: isClosed, icon: CheckCircle2 },
        ].map((step, i) => (
          <div key={i} className="flex flex-col items-center gap-2">
            <div className={cn(
              'h-10 w-10 rounded-full flex items-center justify-center transition-all duration-500',
              step.active ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20' : 'bg-muted text-muted-foreground',
            )}>
              <step.icon className="h-5 w-5" />
            </div>
            <span className={cn('text-[10px] font-bold uppercase tracking-widest', step.active ? 'text-primary' : 'text-muted-foreground')}>
              {step.label}
            </span>
          </div>
        ))}
      </div>

      {/* ── Real-time Stats Bar ─────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Card className="bg-card/50 backdrop-blur-sm">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
              <User className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase text-muted-foreground">Driver</p>
              <p className="text-sm font-black">{sheet.driver?.name}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card/50 backdrop-blur-sm">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="h-10 w-10 rounded-xl bg-orange-500/10 flex items-center justify-center text-orange-500">
              <Droplets className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase text-muted-foreground">Filled Dropped</p>
              <p className="text-sm font-black">{totalFilledDropped} <span className="text-xs font-normal text-muted-foreground">of {sheet.filledOutCount}</span></p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card/50 backdrop-blur-sm">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="h-10 w-10 rounded-xl bg-purple-500/10 flex items-center justify-center text-purple-500">
              <Package className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase text-muted-foreground">Empty Received</p>
              <p className="text-sm font-black">{totalEmptyReceived} <span className="text-xs font-normal text-muted-foreground">bottles</span></p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card/50 backdrop-blur-sm">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="h-10 w-10 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-500">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase text-muted-foreground">Cash Collected</p>
              <p className="text-sm font-black">₨ {totalCashCollected.toLocaleString()}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card/50 backdrop-blur-sm">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="h-10 w-10 rounded-xl bg-blue-500/10 flex items-center justify-center text-blue-500">
              <Truck className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase text-muted-foreground">In Truck</p>
              <p className="text-sm font-black">{bottlesInTruck} bottles</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Load Trips Section ─────────────────────────────── */}
      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="text-lg font-black flex items-center gap-2">
            <Truck className="h-5 w-5 text-primary" />
            Load Trips
            <Badge variant="secondary" className="font-bold text-xs">{loads.length}</Badge>
          </h3>
          <div className="flex gap-2">
            {!isClosed && !activeTrip && isAdminOrStaff && (
              <Button
                size="sm"
                onClick={() => { setNewTripFilled(items.length * 2); setNewTripOpen(true); }}
                className="rounded-full font-bold shadow-lg shadow-primary/20 gap-2"
              >
                <Plus className="h-3.5 w-3.5" />
                New Load-Out
              </Button>
            )}
            {!isClosed && !activeTrip && hasAnyTrip && isAdminOrStaff && (
              <Button
                size="sm"
                variant="default"
                onClick={handleOpenReconcile}
                className="rounded-full font-bold"
              >
                Close & Reconcile
              </Button>
            )}
          </div>
        </div>

        {loads.length === 0 ? (
          <Card className="border-dashed border-2 border-border/40">
            <CardContent className="p-8 flex flex-col items-center gap-3 text-center">
              <Truck className="h-8 w-8 text-muted-foreground/30" />
              <p className="text-sm font-bold text-muted-foreground">No trips yet</p>
              {isAdminOrStaff && (
                <p className="text-xs text-muted-foreground/60 max-w-[220px]">
                  Start a Load-Out to record the first trip for this sheet.
                </p>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {loads.map((trip, idx) => {
              const isActive = !trip.endedAt;
              const duration = trip.endedAt
                ? Math.round((new Date(trip.endedAt).getTime() - new Date(trip.startedAt).getTime()) / 60000)
                : null;

              return (
                <motion.div
                  key={trip.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.05 }}
                >
                  <Card className={cn(
                    'border transition-all overflow-hidden',
                    isActive
                      ? 'border-emerald-500/40 bg-emerald-500/5 shadow-sm shadow-emerald-500/10'
                      : 'border-border/50 bg-card/50',
                  )}>
                    <CardContent className="p-4">
                      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                        <div className="flex items-center gap-3 shrink-0">
                          <div className={cn(
                            'h-9 w-9 rounded-full flex items-center justify-center font-black text-sm relative',
                            isActive ? 'bg-emerald-500 text-white' : 'bg-muted text-muted-foreground',
                          )}>
                            {trip.tripNumber}
                            {isActive && (
                              <span className="absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full bg-emerald-400 animate-ping" />
                            )}
                          </div>
                          <div>
                            <p className="text-xs font-black uppercase tracking-widest text-muted-foreground">
                              Trip {trip.tripNumber}
                            </p>
                            <div className="flex items-center gap-1 mt-0.5">
                              <Clock className="h-2.5 w-2.5 text-muted-foreground" />
                              <span className="text-[10px] text-muted-foreground">
                                {formatTime(trip.startedAt)}
                                {trip.endedAt && ` → ${formatTime(trip.endedAt)} (${duration}m)`}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-3">
                          <div className="rounded-xl bg-orange-500/10 px-3 py-2 text-center">
                            <p className="text-[9px] font-bold uppercase text-orange-500/80">Loaded</p>
                            <p className="text-lg font-black font-mono text-orange-500">{trip.loadedFilled}</p>
                          </div>
                          <div className={cn('rounded-xl px-3 py-2 text-center', trip.endedAt ? 'bg-blue-500/10' : 'bg-muted/30')}>
                            <p className="text-[9px] font-bold uppercase text-muted-foreground">Returned</p>
                            <p className={cn('text-lg font-black font-mono', trip.endedAt ? 'text-blue-500' : 'text-muted-foreground/40')}>
                              {trip.endedAt ? trip.returnedFilled : '—'}
                            </p>
                          </div>
                          <div className={cn('rounded-xl px-3 py-2 text-center', trip.endedAt ? 'bg-purple-500/10' : 'bg-muted/30')}>
                            <p className="text-[9px] font-bold uppercase text-muted-foreground">Empties</p>
                            <p className={cn('text-lg font-black font-mono', trip.endedAt ? 'text-purple-500' : 'text-muted-foreground/40')}>
                              {trip.endedAt ? trip.collectedEmpty : '—'}
                            </p>
                          </div>
                          <div className={cn('rounded-xl px-3 py-2 text-center', trip.endedAt ? 'bg-emerald-500/10' : 'bg-muted/30')}>
                            <p className="text-[9px] font-bold uppercase text-muted-foreground">Cash</p>
                            <p className={cn('text-lg font-black font-mono', trip.endedAt ? 'text-emerald-500' : 'text-muted-foreground/40')}>
                              {trip.endedAt ? `₨${trip.cashHandedIn}` : '—'}
                            </p>
                          </div>
                        </div>

                        {isActive && !isClosed && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="rounded-full font-bold border-emerald-500/50 text-emerald-600 hover:bg-emerald-500/10 shrink-0"
                            onClick={() => {
                              setCheckinForm({ returnedFilled: 0, collectedEmpty: 0, cashHandedIn: 0 });
                              setCheckinOpen(trip.id);
                            }}
                          >
                            Check In
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
          </div>
        )}

        {activeTrip && !isClosed && (
          <div className="flex items-center gap-2 px-4 py-3 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-sm font-semibold text-amber-600">
            <AlertCircle className="h-4 w-4 shrink-0" />
            Trip {activeTrip.tripNumber} is in progress. Check in before starting a new trip.
          </div>
        )}
      </div>

      {/* ── Delivery Queue ─────────────────────────────────── */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-black flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-primary" />
            Delivery Queue
          </h3>
          <p className="text-xs text-muted-foreground font-medium">
            {items.filter((i) => i.status !== 'PENDING').length} / {items.length} done
          </p>
        </div>

        {/* Status Tabs */}
        <Tabs value={activeTab} onValueChange={handleTabChange}>
          <TabsList className="w-full grid grid-cols-4 h-10">
            <TabsTrigger value="all" className="text-xs font-bold">
              All <span className="ml-1 text-[10px] opacity-60">({tabCount('all')})</span>
            </TabsTrigger>
            <TabsTrigger value="pending" className="text-xs font-bold">
              Pending <span className="ml-1 text-[10px] opacity-60">({tabCount('pending')})</span>
            </TabsTrigger>
            <TabsTrigger value="completed" className="text-xs font-bold">
              Done <span className="ml-1 text-[10px] opacity-60">({tabCount('completed')})</span>
            </TabsTrigger>
            <TabsTrigger value="issues" className="text-xs font-bold">
              Issues <span className="ml-1 text-[10px] opacity-60">({tabCount('issues')})</span>
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Item list */}
        <div className="grid gap-2">
          {paginatedItems.length === 0 ? (
            <Card className="border-dashed border-2 border-border/40">
              <CardContent className="p-8 text-center text-sm text-muted-foreground font-medium">
                No items in this category.
              </CardContent>
            </Card>
          ) : (
            paginatedItems.map((item, idx) => {
              const isExpanded = expandedItemId === item.id;
              const customer = item.customer;
              const matchedWallet = customer?.wallets?.find((w) => w.productId === item.productId) ?? customer?.wallets?.[0];
              const walletBalance = matchedWallet?.balance ?? 0;

              return (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.03 }}
                >
                  <Card className={cn(
                    'overflow-hidden border-border/50 transition-all',
                    item.status !== 'PENDING' ? 'bg-muted/30' : 'bg-card/50',
                    isExpanded ? 'border-primary/30 shadow-sm' : 'hover:border-primary/20',
                  )}>
                    {/* Header row — always visible */}
                    <CardContent className="p-4 sm:p-5">
                      <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
                        {/* Sequence + avatar */}
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <div className="h-9 w-9 rounded-full bg-accent flex items-center justify-center shrink-0 font-black text-sm">
                            {item.sequence}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <h4 className="font-bold text-sm truncate">{customer?.name}</h4>
                              <Badge variant="outline" className="text-[9px] font-mono px-1.5">{customer?.customerCode}</Badge>
                            </div>
                            <p className="text-xs text-muted-foreground truncate flex items-center gap-1 mt-0.5">
                              <MapPin className="h-2.5 w-2.5 shrink-0" />
                              {customer?.address}
                              {customer?.floor ? ` · ${customer.floor}` : ''}
                            </p>
                          </div>
                        </div>

                        {/* Status + action */}
                        <div className="flex items-center gap-3 shrink-0">
                          <StatusBadge status={item.status} />
                          {!isClosed && (
                            <Button
                              size="sm"
                              variant={item.status === 'PENDING' ? 'default' : 'outline'}
                              className="rounded-full font-bold text-xs h-8 px-3"
                              onClick={() => handleOpenDelivery(item)}
                            >
                              {item.status === 'PENDING' ? 'Record' : 'Edit'}
                            </Button>
                          )}
                          <button
                            className="h-8 w-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                            onClick={() => setExpandedItemId(isExpanded ? null : item.id)}
                          >
                            {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                          </button>
                        </div>
                      </div>
                    </CardContent>

                    {/* Expanded accordion panel */}
                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          className="overflow-hidden"
                        >
                          <div className="border-t border-border/50 bg-accent/10 p-4 sm:p-5 space-y-4">
                            {/* Wallet + payment */}
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                              <div className="rounded-xl bg-background/70 border border-border/40 px-3 py-2">
                                <p className="text-[9px] font-bold uppercase text-muted-foreground">Bottle Wallet</p>
                                <p className="text-base font-black mt-0.5">{walletBalance} btl</p>
                              </div>
                              <div className="rounded-xl bg-background/70 border border-border/40 px-3 py-2">
                                <p className="text-[9px] font-bold uppercase text-muted-foreground">Balance Due</p>
                                <p className={cn('text-base font-black mt-0.5', (customer?.financialBalance ?? 0) > 0 ? 'text-destructive' : 'text-emerald-600')}>
                                  ₨{(customer?.financialBalance ?? 0).toLocaleString()}
                                </p>
                              </div>
                              <div className="rounded-xl bg-background/70 border border-border/40 px-3 py-2">
                                <p className="text-[9px] font-bold uppercase text-muted-foreground">Payment</p>
                                <p className="text-base font-black mt-0.5">{customer?.paymentType ?? '—'}</p>
                              </div>
                              <div className="rounded-xl bg-background/70 border border-border/40 px-3 py-2">
                                <p className="text-[9px] font-bold uppercase text-muted-foreground">Phone</p>
                                <p className="text-sm font-black mt-0.5 truncate">{customer?.phoneNumber ?? '—'}</p>
                              </div>
                            </div>

                            {/* Address details */}
                            {(customer?.floor || customer?.nearbyLandmark || customer?.deliveryInstructions) && (
                              <div className="rounded-xl bg-background/70 border border-border/40 p-3 space-y-1">
                                {customer?.floor && (
                                  <p className="text-xs text-muted-foreground">
                                    <span className="font-bold">Floor:</span> {customer.floor}
                                  </p>
                                )}
                                {customer?.nearbyLandmark && (
                                  <p className="text-xs text-muted-foreground">
                                    <span className="font-bold">Landmark:</span> {customer.nearbyLandmark}
                                  </p>
                                )}
                                {customer?.deliveryInstructions && (
                                  <p className="text-xs text-amber-700 dark:text-amber-400 font-medium">
                                    <span className="font-bold">Note:</span> {customer.deliveryInstructions}
                                  </p>
                                )}
                              </div>
                            )}

                            {/* Action buttons: Call / WhatsApp / Map */}
                            <div className="flex gap-2 flex-wrap">
                              {customer?.phoneNumber && (
                                <a href={`tel:${customer.phoneNumber}`}>
                                  <Button size="sm" variant="outline" className="rounded-full font-bold gap-1.5 text-xs h-8">
                                    <Phone className="h-3.5 w-3.5" />
                                    Call
                                  </Button>
                                </a>
                              )}
                              {customer?.phoneNumber && (
                                <a
                                  href={`https://wa.me/${formatPhone(customer.phoneNumber)}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  <Button size="sm" variant="outline" className="rounded-full font-bold gap-1.5 text-xs h-8 text-emerald-600 border-emerald-500/30 hover:bg-emerald-500/10">
                                    <MessageCircle className="h-3.5 w-3.5" />
                                    WhatsApp
                                  </Button>
                                </a>
                              )}
                              {customer?.latitude && customer?.longitude && (
                                <a
                                  href={`https://maps.google.com/?q=${customer.latitude},${customer.longitude}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  <Button size="sm" variant="outline" className="rounded-full font-bold gap-1.5 text-xs h-8 text-blue-600 border-blue-500/30 hover:bg-blue-500/10">
                                    <Navigation className="h-3.5 w-3.5" />
                                    Map
                                  </Button>
                                </a>
                              )}
                            </div>

                            {/* Show failure category + reason if unable to deliver */}
                            {item.failureCategory && (
                              <div className="flex items-start gap-2 text-xs bg-destructive/5 rounded-xl px-3 py-2 border border-destructive/20">
                                <AlertCircle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
                                <div>
                                  <span className="font-bold text-destructive">{formatCategory(item.failureCategory)}</span>
                                  {item.reason && <span className="text-muted-foreground"> · {item.reason}</span>}
                                </div>
                              </div>
                            )}
                            {!item.failureCategory && item.reason && (
                              <p className="text-xs text-muted-foreground bg-background/70 rounded-xl px-3 py-2 border border-border/40">
                                <span className="font-bold">Note:</span> {item.reason}
                              </p>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </Card>
                </motion.div>
              );
            })
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between gap-2 pt-2">
            <Button
              size="sm"
              variant="outline"
              className="rounded-full font-bold"
              disabled={tabPage <= 1}
              onClick={() => setTabPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </Button>
            <span className="text-xs text-muted-foreground font-medium">
              Page {tabPage} of {totalPages} · {filteredItems.length} items
            </span>
            <Button
              size="sm"
              variant="outline"
              className="rounded-full font-bold"
              disabled={tabPage >= totalPages}
              onClick={() => setTabPage((p) => Math.min(totalPages, p + 1))}
            >
              Next
            </Button>
          </div>
        )}
      </div>

      {/* ── Close & Reconcile Dialog ────────────────────────── */}
      <Dialog open={reconcileOpen} onOpenChange={(o) => { if (!o) { setReconcileOpen(false); setReconcileData(null); } }}>
        <DialogContent className="rounded-3xl max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-xl font-black flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-primary" />
              Close & Reconcile
            </DialogTitle>
          </DialogHeader>

          {reconcileLoading ? (
            <div className="py-12 flex flex-col items-center gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Loading reconciliation data...</p>
            </div>
          ) : reconcileData ? (
            <div className="space-y-4 py-4">
              {/* Pending warning */}
              {reconcileData.pendingCount > 0 && (
                <div className="flex items-start gap-2 px-4 py-3 rounded-2xl bg-destructive/10 border border-destructive/20 text-sm font-semibold text-destructive">
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  {reconcileData.pendingCount} item(s) still PENDING — resolve them before closing.
                </div>
              )}

              {/* Bottle reconciliation */}
              <div className="rounded-2xl border border-border/50 bg-accent/10 overflow-hidden">
                <div className="px-4 py-2.5 bg-muted/40 border-b border-border/40">
                  <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Bottle Summary</p>
                </div>
                <div className="p-4 grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[10px] text-muted-foreground font-bold uppercase">Dispatched</p>
                    <p className="text-xl font-black font-mono">{reconcileData.bottles.dispatched}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground font-bold uppercase">Delivered</p>
                    <p className="text-xl font-black font-mono">{reconcileData.bottles.delivered}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground font-bold uppercase">Returned to Warehouse</p>
                    <p className="text-xl font-black font-mono">{reconcileData.bottles.returned}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground font-bold uppercase">Discrepancy</p>
                    <p className={cn(
                      'text-xl font-black font-mono',
                      reconcileData.bottles.discrepancy !== 0 ? 'text-destructive' : 'text-emerald-600',
                    )}>
                      {reconcileData.bottles.discrepancy > 0 ? '+' : ''}{reconcileData.bottles.discrepancy}
                      {reconcileData.bottles.discrepancy !== 0 && ' ⚠️'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Cash reconciliation */}
              <div className="rounded-2xl border border-border/50 bg-accent/10 overflow-hidden">
                <div className="px-4 py-2.5 bg-muted/40 border-b border-border/40">
                  <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Cash Summary</p>
                </div>
                <div className="divide-y divide-border/40">
                  {/* Cash customers row */}
                  <div className="p-4 space-y-2">
                    <p className="text-xs font-black text-foreground">
                      Cash Customers ({reconcileData.cashCustomers.count} deliveries)
                    </p>
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-xl bg-background/70 border border-border/40 px-2 py-2">
                        <p className="text-[9px] font-bold uppercase text-muted-foreground">Billed</p>
                        <p className="text-sm font-black font-mono">₨{reconcileData.cashCustomers.billed.toLocaleString()}</p>
                      </div>
                      <div className="rounded-xl bg-background/70 border border-border/40 px-2 py-2">
                        <p className="text-[9px] font-bold uppercase text-muted-foreground">Collected</p>
                        <p className="text-sm font-black font-mono text-emerald-600">₨{reconcileData.cashCustomers.collected.toLocaleString()}</p>
                      </div>
                      <div className={cn(
                        'rounded-xl border px-2 py-2',
                        reconcileData.cashCustomers.addedToBalance > 0
                          ? 'bg-amber-500/10 border-amber-500/30'
                          : 'bg-background/70 border-border/40',
                      )}>
                        <p className="text-[9px] font-bold uppercase text-muted-foreground">→ Balance</p>
                        <p className={cn(
                          'text-sm font-black font-mono',
                          reconcileData.cashCustomers.addedToBalance > 0 ? 'text-amber-600' : 'text-muted-foreground',
                        )}>
                          ₨{reconcileData.cashCustomers.addedToBalance.toLocaleString()}
                        </p>
                      </div>
                    </div>
                    {reconcileData.cashCustomers.addedToBalance > 0 && (
                      <p className="text-[11px] text-amber-600 font-medium">
                        ₨{reconcileData.cashCustomers.addedToBalance.toLocaleString()} added to customer balances (unpaid cash deliveries)
                      </p>
                    )}
                  </div>

                  {/* Monthly customers row */}
                  {reconcileData.monthlyCustomers.count > 0 && (
                    <div className="p-4 flex items-center justify-between">
                      <div>
                        <p className="text-xs font-black">Monthly Customers ({reconcileData.monthlyCustomers.count} deliveries)</p>
                        <p className="text-[11px] text-muted-foreground">Billed to accounts — no cash expected</p>
                      </div>
                      <p className="text-sm font-black font-mono text-blue-600">
                        ₨{reconcileData.monthlyCustomers.billedToAccounts.toLocaleString()}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Driver handover */}
              <div className={cn(
                'rounded-2xl border overflow-hidden',
                reconcileData.driver.discrepancy !== 0
                  ? 'border-destructive/30 bg-destructive/5'
                  : 'border-emerald-500/30 bg-emerald-500/5',
              )}>
                <div className="px-4 py-2.5 border-b border-border/40 bg-muted/40">
                  <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Driver Handover</p>
                </div>
                <div className="p-4 grid grid-cols-3 gap-3 text-center">
                  <div>
                    <p className="text-[9px] font-bold uppercase text-muted-foreground">Should Hand In</p>
                    <p className="text-lg font-black font-mono">₨{reconcileData.driver.shouldHandIn.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-[9px] font-bold uppercase text-muted-foreground">Handed In</p>
                    <p className="text-lg font-black font-mono">₨{reconcileData.driver.handedIn.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-[9px] font-bold uppercase text-muted-foreground">Difference</p>
                    <p className={cn(
                      'text-lg font-black font-mono',
                      reconcileData.driver.discrepancy !== 0 ? 'text-destructive' : 'text-emerald-600',
                    )}>
                      {reconcileData.driver.discrepancy !== 0
                        ? `₨${Math.abs(reconcileData.driver.discrepancy).toLocaleString()} ${reconcileData.driver.discrepancy > 0 ? 'short' : 'over'} ⚠️`
                        : '✓ Clear'}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="ghost" onClick={() => { setReconcileOpen(false); setReconcileData(null); }}>
              Cancel
            </Button>
            <Button
              onClick={() => closeSheet(undefined, {
                onSuccess: () => { setReconcileOpen(false); setReconcileData(null); },
              })}
              disabled={isClosing || reconcileLoading || !reconcileData || reconcileData.pendingCount > 0}
              className="rounded-xl font-bold min-w-[140px]"
            >
              {isClosing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Confirm Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── New Load-Out Dialog ─────────────────────────────── */}
      <Dialog open={newTripOpen} onOpenChange={setNewTripOpen}>
        <DialogContent className="rounded-3xl max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-xl font-black flex items-center gap-2">
              <Package className="h-5 w-5 text-primary" />
              Start Load-Out
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
                Trip {loads.length + 1} — Filled Bottles Dispatched
              </Label>
              <Input
                type="number"
                min={1}
                value={newTripFilled}
                onChange={(e) => setNewTripFilled(Number(e.target.value))}
                className="h-14 text-3xl font-black font-mono text-center"
              />
              <p className="text-[11px] text-muted-foreground">Total filled bottles loaded into the van for this trip.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setNewTripOpen(false)}>Cancel</Button>
            <Button
              onClick={() => createLoad({ loadedFilled: newTripFilled }, { onSuccess: () => setNewTripOpen(false) })}
              disabled={isStartingTrip || newTripFilled < 1}
              className="rounded-xl font-bold"
            >
              {isStartingTrip ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Confirm Dispatch
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Check-In Dialog ────────────────────────────────── */}
      <Dialog open={!!checkinOpen} onOpenChange={(o) => !o && setCheckinOpen(null)}>
        <DialogContent className="rounded-3xl max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl font-black flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-500" />
              Trip Check-In
            </DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-4">
            <div className="space-y-2">
              <Label className="font-bold text-xs uppercase tracking-widest">Filled Returned</Label>
              <Input
                type="number"
                min={0}
                value={checkinForm.returnedFilled}
                onChange={(e) => setCheckinForm((p) => ({ ...p, returnedFilled: Number(e.target.value) }))}
                className="font-mono font-bold"
              />
            </div>
            <div className="space-y-2">
              <Label className="font-bold text-xs uppercase tracking-widest">Empties Collected</Label>
              <Input
                type="number"
                min={0}
                value={checkinForm.collectedEmpty}
                onChange={(e) => setCheckinForm((p) => ({ ...p, collectedEmpty: Number(e.target.value) }))}
                className="font-mono font-bold"
              />
            </div>
            <div className="col-span-2 space-y-2">
              <Label className="font-bold text-xs uppercase tracking-widest">Cash Handed In (₨)</Label>
              <Input
                type="number"
                min={0}
                value={checkinForm.cashHandedIn}
                onChange={(e) => setCheckinForm((p) => ({ ...p, cashHandedIn: Number(e.target.value) }))}
                className="h-14 text-2xl font-black font-mono text-center"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCheckinOpen(null)}>Cancel</Button>
            <Button
              onClick={() => checkinLoad(
                { loadId: checkinOpen!, data: checkinForm },
                { onSuccess: () => setCheckinOpen(null) },
              )}
              disabled={isCheckingIn}
              className="rounded-xl font-bold"
            >
              {isCheckingIn ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Confirm Check-In
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Swap Assignment Dialog ───────────────────────────── */}
      <Dialog open={swapOpen} onOpenChange={(o) => { setSwapOpen(o); if (!o) setSwapForm({}); }}>
        <DialogContent className="rounded-3xl max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-xl font-black flex items-center gap-2">
              <ArrowRightLeft className="h-5 w-5 text-primary" />
              Swap Assignment
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-5 py-4">
            {/* Driver section */}
            <div className="space-y-3 p-4 rounded-2xl bg-accent/20 border border-border/30">
              <div className="flex items-center justify-between">
                <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">Driver</Label>
                <span className="text-[10px] text-muted-foreground">This sheet only</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                <User className="h-3.5 w-3.5" />
                <span>Current: <span className="font-bold text-foreground">{sheet.driver?.name ?? '—'}</span></span>
              </div>
              <Select
                value={swapForm.driverId ?? ''}
                onValueChange={(v) => setSwapForm((p) => ({ ...p, driverId: v || undefined }))}
              >
                <SelectTrigger className="h-10">
                  <SelectValue placeholder="Keep current driver" />
                </SelectTrigger>
                <SelectContent>
                  {allDrivers
                    .filter((d) => d.id !== sheet.driverId)
                    .map((d) => (
                      <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
              {swapForm.driverId && (
                <button
                  className="text-[11px] text-muted-foreground underline"
                  onClick={() => setSwapForm((p) => ({ ...p, driverId: undefined }))}
                >
                  Clear driver change
                </button>
              )}
            </div>

            {/* Van section */}
            <div className="space-y-3 p-4 rounded-2xl bg-accent/20 border border-border/30">
              <div className="flex items-center justify-between">
                <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">Van</Label>
                <span className="text-[10px] text-muted-foreground">This sheet only</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                <Truck className="h-3.5 w-3.5" />
                <span>Current: <span className="font-bold text-foreground">{sheet.van?.plateNumber ?? '—'}</span></span>
              </div>
              <Select
                value={swapForm.vanId ?? ''}
                onValueChange={(v) => setSwapForm((p) => ({ ...p, vanId: v || undefined }))}
              >
                <SelectTrigger className="h-10">
                  <SelectValue placeholder="Keep current van" />
                </SelectTrigger>
                <SelectContent>
                  {allVans
                    .filter((v) => v.id !== sheet.vanId)
                    .map((v) => (
                      <SelectItem key={v.id} value={v.id}>{v.plateNumber}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
              {swapForm.vanId && (
                <button
                  className="text-[11px] text-muted-foreground underline"
                  onClick={() => setSwapForm((p) => ({ ...p, vanId: undefined }))}
                >
                  Clear van change
                </button>
              )}
            </div>

            {/* Info note */}
            <p className="text-[11px] text-muted-foreground bg-muted/40 rounded-xl px-3 py-2">
              These changes apply to this sheet only. To permanently change a van&apos;s default driver, update the van in Settings.
            </p>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => { setSwapOpen(false); setSwapForm({}); }}>Cancel</Button>
            <Button
              onClick={() => swapAssignment(swapForm, { onSuccess: () => { setSwapOpen(false); setSwapForm({}); } })}
              disabled={isSwapping || (!swapForm.vanId && !swapForm.driverId)}
              className="rounded-xl font-bold"
            >
              {isSwapping ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Confirm Swap
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delivery Action Dialog ──────────────────────────── */}
      <Dialog open={!!deliveryOpen} onOpenChange={(o) => !o && setDeliveryOpen(null)}>
        <DialogContent className="rounded-3xl max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl font-black flex items-center gap-2">
              <Droplets className="h-5 w-5 text-primary" />
              {(() => {
                const item = items.find((i) => i.id === deliveryOpen);
                return item?.customer?.name ?? 'Record Delivery';
              })()}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-5 py-4">
            {/* Delivered / Unable to Deliver toggle */}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setDeliveryMode('delivered')}
                className={cn(
                  'flex-1 py-3 px-4 rounded-2xl text-sm font-bold border-2 transition-all',
                  deliveryMode === 'delivered'
                    ? 'bg-emerald-500/10 border-emerald-500 text-emerald-700 dark:text-emerald-400'
                    : 'bg-background border-border/50 text-muted-foreground hover:border-emerald-500/30',
                )}
              >
                Delivered
              </button>
              <button
                type="button"
                onClick={() => setDeliveryMode('unable')}
                className={cn(
                  'flex-1 py-3 px-4 rounded-2xl text-sm font-bold border-2 transition-all',
                  deliveryMode === 'unable'
                    ? 'bg-destructive/10 border-destructive text-destructive'
                    : 'bg-background border-border/50 text-muted-foreground hover:border-destructive/30',
                )}
              >
                Unable to Deliver
              </button>
            </div>

            {deliveryMode === 'delivered' ? (
              /* Delivery fields */
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="font-bold text-xs uppercase tracking-widest">Dropped</Label>
                    <Input
                      type="number"
                      min={0}
                      value={itemForm.filledDropped ?? 1}
                      onChange={(e) => setItemForm((p) => ({ ...p, filledDropped: Number(e.target.value) }))}
                      className="font-mono font-bold h-11"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="font-bold text-xs uppercase tracking-widest">Empties Received</Label>
                    <Input
                      type="number"
                      min={0}
                      value={itemForm.emptyReceived ?? 0}
                      onChange={(e) => setItemForm((p) => ({ ...p, emptyReceived: Number(e.target.value) }))}
                      className="font-mono font-bold h-11"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="font-bold text-xs uppercase tracking-widest">Cash Collected (₨)</Label>
                  <Input
                    type="number"
                    min={0}
                    value={itemForm.cashCollected ?? 0}
                    onChange={(e) => setItemForm((p) => ({ ...p, cashCollected: Number(e.target.value) }))}
                    className="h-12 text-lg font-black font-mono text-center bg-emerald-500/5 border-emerald-500/20 text-emerald-600 dark:text-emerald-400"
                  />
                </div>
              </div>
            ) : (
              /* Unable to deliver fields */
              <div className="space-y-4">
                {/* Reason category — required */}
                <div className="space-y-2">
                  <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
                    Reason Category <span className="text-destructive">*</span>
                  </Label>
                  <Select value={failureCategory} onValueChange={setFailureCategory}>
                    <SelectTrigger className="h-11 rounded-xl">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl border-border/50 shadow-2xl">
                      {FAILURE_CATEGORIES.map((cat) => (
                        <SelectItem key={cat.value} value={cat.value} className="rounded-lg">
                          {cat.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Optional notes */}
                <div className="space-y-2">
                  <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
                    Notes (optional)
                  </Label>
                  <Input
                    placeholder="Additional details..."
                    value={unableReason}
                    onChange={(e) => setUnableReason(e.target.value)}
                    className="h-11"
                  />
                </div>

                <p className="text-[11px] text-muted-foreground bg-blue-500/5 border border-blue-500/20 rounded-xl px-3 py-2">
                  This reports an issue for ops planning. Drivers cannot reschedule or cancel from this screen.
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeliveryOpen(null)}>Discard</Button>
            <Button
              onClick={onSaveItem}
              disabled={isUpdatingItem}
              className="rounded-xl font-bold min-w-[120px]"
            >
              {isUpdatingItem ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Save Record
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
