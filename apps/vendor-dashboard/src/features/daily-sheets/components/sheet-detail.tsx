'use client';

import { useReducer, useMemo } from 'react';
import { Card, CardContent, Skeleton } from '@water-supply-crm/ui';
import { useDailySheet } from '../hooks/use-daily-sheets';
import { dailySheetsApi } from '../api/daily-sheets.api';
import { DeliveryDialog } from './dialogs/delivery-dialog';
import { CheckinDialog } from './dialogs/checkin-dialog';
import { NewTripDialog } from './dialogs/new-trip-dialog';
import { SwapDialog } from './dialogs/swap-dialog';
import { ReconcileDialog } from './dialogs/reconcile-dialog';
import { toast } from 'sonner';
import {
  CheckCircle2, ClipboardList, DollarSign,
  Droplets, Package, Truck, User,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { cn } from '@water-supply-crm/ui';
import type { DeliveryItem, LoadTrip } from '@water-supply-crm/types';
import { useAuthStore } from '../../../store/auth.store';
import { hasMinRole } from '../../../lib/rbac';
import { SheetDetailHeader } from './sheet-detail-header';
import { LoadTripsSection } from './load-trips-section';
import { DeliveryItemsList } from './delivery-items-list';


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
  const [ui, dispatch] = useReducer(uiReducer, initialUiState);

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

  const activeTrip = loads.find((l) => !l.endedAt) ?? null;
  const hasAnyTrip = loads.length > 0;
  const isClosed = !!data?.isClosed;
  const currentStatus = isClosed ? 'CLOSED' : activeTrip ? 'LOADED' : hasAnyTrip ? 'CHECKED_IN' : 'OPEN';
  const bottlesInTruck = Math.max(0, (data?.filledOutCount ?? 0) - stats.filledDropped);
  const tabCount = (tab: TabKey) => items.filter((i) => tabFilter(tab, i)).length;

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
      <SheetDetailHeader
        date={data!.date}
        routeName={data?.route?.name ?? null}
        vanPlateNumber={data?.van?.plateNumber ?? null}
        currentStatus={currentStatus}
        isClosed={isClosed}
        isAdmin={isAdmin}
        isDriver={isDriver}
        onBack={() => router.back()}
        onSwap={() => dispatch({ type: 'OPEN_SWAP' })}
        onExportPdf={handleExportPdf}
        onPrintInvoice={handlePrintInvoice}
      />

      {/* Lifecycle Stepper */}
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

      {/* Stats Bar */}
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

      <LoadTripsSection
        loads={loads}
        isClosed={isClosed}
        activeTrip={activeTrip}
        hasAnyTrip={hasAnyTrip}
        isAdminOrStaff={isAdminOrStaff}
        onNewTrip={() => dispatch({ type: 'OPEN_NEW_TRIP' })}
        onReconcile={() => dispatch({ type: 'OPEN_RECONCILE' })}
        onCheckin={(tripId) => dispatch({ type: 'OPEN_CHECKIN', tripId })}
      />

      <DeliveryItemsList
        items={items}
        paginatedItems={paginatedItems}
        filteredItems={filteredItems}
        activeTab={ui.activeTab}
        tabPage={ui.tabPage}
        totalPages={totalPages}
        expandedItemId={ui.expandedItemId}
        isClosed={isClosed}
        tabCount={tabCount}
        onTabChange={(tab) => dispatch({ type: 'SET_TAB', tab: tab as TabKey })}
        onPageChange={(page) => dispatch({ type: 'SET_PAGE', page })}
        onToggleExpand={(itemId) => dispatch({ type: 'SET_EXPANDED', itemId })}
        onOpenDelivery={(item) => {
          if (!isClosed) dispatch({ type: 'OPEN_DELIVERY', itemId: item.id });
        }}
      />

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
