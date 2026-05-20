'use client';

import { useReducer, useMemo } from 'react';
import {
  Card, CardContent, Button, Skeleton, Badge,
  Tabs, TabsList, TabsTrigger,
} from '@water-supply-crm/ui';
import { StatusBadge } from '../../../components/shared/status-badge';
import { useDailySheet } from '../hooks/use-daily-sheets';
import { dailySheetsApi } from '../api/daily-sheets.api';
import { DeliveryDialog } from './dialogs/delivery-dialog';
import { CheckinDialog } from './dialogs/checkin-dialog';
import { NewTripDialog } from './dialogs/new-trip-dialog';
import { SwapDialog } from './dialogs/swap-dialog';
import { ReconcileDialog } from './dialogs/reconcile-dialog';
import { toast } from 'sonner';
import {
  Truck, Package, CheckCircle2, ClipboardList,
  ArrowLeft, Download, MapPin, User, ArrowRightLeft,
  Droplets, DollarSign, AlertCircle, Plus,
  ChevronDown, ChevronUp, Clock,
  Phone, MessageCircle, Navigation, Printer,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { cn } from '@water-supply-crm/ui';
import { motion, AnimatePresence } from 'framer-motion';
import type { DeliveryItem, LoadTrip } from '@water-supply-crm/types';
import { useAuthStore } from '../../../store/auth.store';
import { hasMinRole } from '../../../lib/rbac';


interface UiState {
  newTripOpen: boolean;
  checkinOpen: string | null;
  deliveryOpen: string | null;
  swapOpen: boolean;
  reconcileOpen: boolean;
  activeTab: TabKey;
  tabPage: number;
  expandedItemId: string | null;
}

type UiAction =
  | { type: 'OPEN_NEW_TRIP' }
  | { type: 'CLOSE_NEW_TRIP' }
  | { type: 'OPEN_CHECKIN'; tripId: string }
  | { type: 'CLOSE_CHECKIN' }
  | { type: 'OPEN_DELIVERY'; itemId: string }
  | { type: 'CLOSE_DELIVERY' }
  | { type: 'OPEN_SWAP' }
  | { type: 'CLOSE_SWAP' }
  | { type: 'OPEN_RECONCILE' }
  | { type: 'CLOSE_RECONCILE' }
  | { type: 'SET_TAB'; tab: TabKey }
  | { type: 'SET_PAGE'; page: number }
  | { type: 'SET_EXPANDED'; itemId: string | null };

const initialUiState: UiState = {
  newTripOpen: false,
  checkinOpen: null,
  deliveryOpen: null,
  swapOpen: false,
  reconcileOpen: false,
  activeTab: 'all',
  tabPage: 1,
  expandedItemId: null,
};

function uiReducer(state: UiState, action: UiAction): UiState {
  switch (action.type) {
    case 'OPEN_NEW_TRIP': return { ...state, newTripOpen: true };
    case 'CLOSE_NEW_TRIP': return { ...state, newTripOpen: false };
    case 'OPEN_CHECKIN': return { ...state, checkinOpen: action.tripId };
    case 'CLOSE_CHECKIN': return { ...state, checkinOpen: null };
    case 'OPEN_DELIVERY': return { ...state, deliveryOpen: action.itemId };
    case 'CLOSE_DELIVERY': return { ...state, deliveryOpen: null, expandedItemId: null };
    case 'OPEN_SWAP': return { ...state, swapOpen: true };
    case 'CLOSE_SWAP': return { ...state, swapOpen: false };
    case 'OPEN_RECONCILE': return { ...state, reconcileOpen: true };
    case 'CLOSE_RECONCILE': return { ...state, reconcileOpen: false };
    case 'SET_TAB': return { ...state, activeTab: action.tab, tabPage: 1, expandedItemId: null };
    case 'SET_PAGE': return { ...state, tabPage: action.page };
    case 'SET_EXPANDED': return { ...state, expandedItemId: action.itemId };
  }
}

interface SheetDetailProps {
  sheetId: string;
}

type TabKey = 'all' | 'pending' | 'completed' | 'issues';

const ITEMS_PER_PAGE = 20;

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

function tabFilter(tab: TabKey, item: DeliveryItem): boolean {
  switch (tab) {
    case 'pending': return item.status === 'PENDING';
    case 'completed': return item.status === 'COMPLETED' || item.status === 'EMPTY_ONLY';
    case 'issues': return item.status === 'RESCHEDULED' || item.status === 'CANCELLED' || item.status === 'NOT_AVAILABLE';
    default: return true;
  }
}

const formatTime = (dt: string) =>
  new Date(dt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const formatPhone = (phone?: string | null) => {
  if (!phone) return '';
  return phone.startsWith('0') ? `92${phone.slice(1)}` : phone;
};

export function SheetDetail({ sheetId }: SheetDetailProps) {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const isDriver = user?.role === 'DRIVER';
  const isAdminOrStaff = user ? hasMinRole(user.role, 'STAFF') : false;
  const isAdmin = user ? hasMinRole(user.role, 'VENDOR_ADMIN') : false;

  const { data, isLoading } = useDailySheet(sheetId);
  const [ui, dispatch] = useReducer(uiReducer, initialUiState);

  // ── Memoized derived data (must be before any early returns) ─────────
  const items = useMemo(() => data?.items ?? [], [data]);
  const loads = useMemo(() => data?.loads ?? [], [data]);
  const doneItems = useMemo(
    () => items.filter((i) => i.status === 'COMPLETED' || i.status === 'EMPTY_ONLY'),
    [items],
  );
  const stats = useMemo(() => ({
    filledDropped: doneItems.reduce((acc, i) => acc + i.filledDropped, 0),
    emptyReceived: doneItems.reduce((acc, i) => acc + i.emptyReceived, 0),
    cashCollected: doneItems.reduce((acc, i) => acc + i.cashCollected, 0),
  }), [doneItems]);
  const filteredItems = useMemo(() => items.filter((i) => tabFilter(ui.activeTab, i)), [items, ui.activeTab]);
  const totalPages = useMemo(() => Math.max(1, Math.ceil(filteredItems.length / ITEMS_PER_PAGE)), [filteredItems]);
  const paginatedItems = useMemo(
    () => filteredItems.slice((ui.tabPage - 1) * ITEMS_PER_PAGE, ui.tabPage * ITEMS_PER_PAGE),
    [filteredItems, ui.tabPage],
  );

  if (isLoading) return (
    <div className="space-y-6">
      <Skeleton className="h-20 w-full rounded-3xl" />
      <Skeleton className="h-96 w-full rounded-3xl" />
    </div>
  );

  // items / loads / doneItems / stats / filteredItems / paginatedItems / totalPages — memoized above

  const activeTrip = loads.find((l) => !l.endedAt) ?? null;
  const hasAnyTrip = loads.length > 0;
  const isClosed = !!data?.isClosed;
  const currentStatus = isClosed ? 'CLOSED' : activeTrip ? 'LOADED' : hasAnyTrip ? 'CHECKED_IN' : 'OPEN';
  const bottlesInTruck = Math.max(0, (data?.filledOutCount ?? 0) - stats.filledDropped);

  const tabCount = (tab: TabKey) => items.filter((i) => tabFilter(tab, i)).length;

  const handleTabChange = (tab: string) => dispatch({ type: 'SET_TAB', tab: tab as TabKey });

  const handleOpenDelivery = (item: DeliveryItem) => {
    if (isClosed) return;
    dispatch({ type: 'OPEN_DELIVERY', itemId: item.id });
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
              {new Date(data!.date).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
            </h1>
            <StatusBadge status={currentStatus} />
          </div>
          <p className="text-muted-foreground text-sm flex items-center gap-2 mt-1 font-medium">
            <MapPin className="h-3 w-3" /> {data?.route?.name ?? 'No Route'} • <Truck className="h-3 w-3 ml-1" /> {data?.van?.plateNumber}
          </p>
        </div>
        <div className="flex gap-2">
          {!isClosed && isAdmin && (
            <Button
              variant="outline"
              size="icon"
              className="rounded-full"
              onClick={() => dispatch({ type: 'OPEN_SWAP' })}
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
              <p className="text-sm font-black">{data?.driver?.name}</p>
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
              <p className="text-sm font-black">{stats.filledDropped} <span className="text-xs font-normal text-muted-foreground">of {data?.filledOutCount}</span></p>
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
              <p className="text-sm font-black">{stats.emptyReceived} <span className="text-xs font-normal text-muted-foreground">bottles</span></p>
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
              <p className="text-sm font-black">₨ {stats.cashCollected.toLocaleString()}</p>
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
                onClick={() => dispatch({ type: 'OPEN_NEW_TRIP' })}
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
                onClick={() => dispatch({ type: 'OPEN_RECONCILE' })}
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
                            onClick={() => dispatch({ type: 'OPEN_CHECKIN', tripId: trip.id })}
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
        <Tabs value={ui.activeTab} onValueChange={handleTabChange}>
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
              const isExpanded = ui.expandedItemId === item.id;
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
                            onClick={() => dispatch({ type: 'SET_EXPANDED', itemId: isExpanded ? null : item.id })}
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
              disabled={ui.tabPage <= 1}
              onClick={() => dispatch({ type: 'SET_PAGE', page: Math.max(1, ui.tabPage - 1) })}
            >
              Previous
            </Button>
            <span className="text-xs text-muted-foreground font-medium">
              Page {ui.tabPage} of {totalPages} · {filteredItems.length} items
            </span>
            <Button
              size="sm"
              variant="outline"
              className="rounded-full font-bold"
              disabled={ui.tabPage >= totalPages}
              onClick={() => dispatch({ type: 'SET_PAGE', page: Math.min(totalPages, ui.tabPage + 1) })}
            >
              Next
            </Button>
          </div>
        )}
      </div>

      <ReconcileDialog
        open={ui.reconcileOpen}
        onClose={() => dispatch({ type: 'CLOSE_RECONCILE' })}
        sheetId={sheetId}
      />
      <NewTripDialog
        open={ui.newTripOpen}
        onClose={() => dispatch({ type: 'CLOSE_NEW_TRIP' })}
        sheetId={sheetId}
        tripNumber={loads.length + 1}
        defaultFilled={items.length * 2}
      />
      <CheckinDialog
        open={ui.checkinOpen}
        onClose={() => dispatch({ type: 'CLOSE_CHECKIN' })}
        sheetId={sheetId}
      />
      <SwapDialog
        open={ui.swapOpen}
        onClose={() => dispatch({ type: 'CLOSE_SWAP' })}
        sheetId={sheetId}
        currentDriverId={data?.driverId}
        currentDriverName={data?.driver?.name}
        currentVanId={data?.vanId}
        currentVanPlate={data?.van?.plateNumber}
      />
      <DeliveryDialog
        open={ui.deliveryOpen}
        onClose={() => dispatch({ type: 'CLOSE_DELIVERY' })}
        sheetId={sheetId}
        items={items}
      />
    </div>
  );
}
