'use client';

import { useReducer, useMemo, useEffect, useRef } from 'react';
import { Button, Card, CardContent, Skeleton } from '@water-supply-crm/ui';
import { useDailySheet, useUpdateCustomerLocation, useUnlockDeliveryEdit, useRequestDeliveryEdit } from '../hooks/use-daily-sheets';
import { dailySheetsApi } from '../api/daily-sheets.api';
import { CheckinDialog } from './dialogs/checkin-dialog';
import { NewTripDialog } from './dialogs/new-trip-dialog';
import { SwapDialog } from './dialogs/swap-dialog';
import { ReconcileDialog } from './dialogs/reconcile-dialog';
import { AdhocDeliveryDialog } from './dialogs/adhoc-delivery-dialog';
import { CorrectionEntryDialog } from './dialogs/correction-entry-dialog';
import { BulkImportDialog } from './dialogs/bulk-import-dialog';
import { toast } from 'sonner';
import {
  CheckCircle2, ClipboardList, DollarSign,
  Droplets, Package, Plus, Receipt, Truck, Upload, User,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { cn } from '@water-supply-crm/ui';
import type { DeliveryItem, LoadTrip } from '@water-supply-crm/types';
import { useAuthStore } from '../../../store/auth.store';
import { hasMinRole } from '../../../lib/rbac';
import { SheetDetailHeader } from './sheet-detail-header';
import { LoadTripsSection } from './load-trips-section';
import { DeliveryItemsList } from './delivery-items-list';
import { SheetExpensesSection } from './sheet-expenses-section';


interface UiState {
  newTripOpen: boolean;
  checkinOpen: string | null;
  swapOpen: boolean;
  reconcileOpen: boolean;
  adhocOpen: boolean;
  correctionOpen: boolean;
  bulkImportOpen: boolean;
  activeTab: TabKey;
  tabPage: number;
  expandedItemId: string | null;
}

type UiAction =
  | { type: 'OPEN_NEW_TRIP' }
  | { type: 'CLOSE_NEW_TRIP' }
  | { type: 'OPEN_CHECKIN'; tripId: string }
  | { type: 'CLOSE_CHECKIN' }
  | { type: 'OPEN_SWAP' }
  | { type: 'CLOSE_SWAP' }
  | { type: 'OPEN_RECONCILE' }
  | { type: 'CLOSE_RECONCILE' }
  | { type: 'OPEN_ADHOC' }
  | { type: 'CLOSE_ADHOC' }
  | { type: 'OPEN_CORRECTION' }
  | { type: 'CLOSE_CORRECTION' }
  | { type: 'OPEN_BULK_IMPORT' }
  | { type: 'CLOSE_BULK_IMPORT' }
  | { type: 'SET_TAB'; tab: TabKey }
  | { type: 'SET_PAGE'; page: number }
  | { type: 'SET_EXPANDED'; itemId: string | null };

const initialUiState: UiState = {
  newTripOpen: false,
  checkinOpen: null,
  swapOpen: false,
  reconcileOpen: false,
  adhocOpen: false,
  correctionOpen: false,
  bulkImportOpen: false,
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
    case 'OPEN_SWAP': return { ...state, swapOpen: true };
    case 'CLOSE_SWAP': return { ...state, swapOpen: false };
    case 'OPEN_RECONCILE': return { ...state, reconcileOpen: true };
    case 'CLOSE_RECONCILE': return { ...state, reconcileOpen: false };
    case 'OPEN_ADHOC': return { ...state, adhocOpen: true };
    case 'CLOSE_ADHOC': return { ...state, adhocOpen: false };
    case 'OPEN_CORRECTION': return { ...state, correctionOpen: true };
    case 'CLOSE_CORRECTION': return { ...state, correctionOpen: false };
    case 'OPEN_BULK_IMPORT': return { ...state, bulkImportOpen: true };
    case 'CLOSE_BULK_IMPORT': return { ...state, bulkImportOpen: false };
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
  const updateCustomerLocation = useUpdateCustomerLocation(sheetId);
  const unlockDeliveryEdit = useUnlockDeliveryEdit(sheetId);
  const requestDeliveryEdit = useRequestDeliveryEdit(sheetId);
  const [ui, dispatch] = useReducer(uiReducer, initialUiState);

  const items = useMemo(() => data?.items ?? [], [data]);

  // Drivers stay on 'all' tab so completed deliveries remain visible after recording.
  // Non-driver users auto-switch to 'pending' on first load when pending items exist.
  const hasDefaultedTab = useRef(false);
  useEffect(() => {
    if (isDriver || hasDefaultedTab.current || items.length === 0) return;
    hasDefaultedTab.current = true;
    const pendingCount = items.filter((i) => i.status === 'PENDING').length;
    if (pendingCount > 0) {
      dispatch({ type: 'SET_TAB', tab: 'pending' });
    }
  }, [items, isDriver]);
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

  if (!data) return (
    <div className="flex flex-col items-center justify-center py-24 text-center space-y-3">
      <p className="text-sm font-bold text-foreground">Sheet not found</p>
      <p className="text-xs text-muted-foreground">This daily sheet may have been deleted or you don&apos;t have access.</p>
    </div>
  );

  const activeTrip = loads.find((l) => !l.endedAt) ?? null;
  const hasAnyTrip = loads.length > 0;
  const isClosed = !!data?.isClosed;
  const currentStatus = isClosed ? 'CLOSED' : activeTrip ? 'LOADED' : hasAnyTrip ? 'CHECKED_IN' : 'OPEN';
  const bottlesInTruck = Math.max(0, (data?.filledOutCount ?? 0) - stats.filledDropped);

  // Pre-fill values for check-in dialog
  const activeLoad = data?.loads?.find((l: any) => !l.endedAt);
  const loadedFilled = activeLoad?.loadedFilled ?? 0;
  const doneItemsForCheckin = (data?.items ?? []).filter((i: any) => ['COMPLETED', 'EMPTY_ONLY'].includes(i.status));
  const suggestedReturned = Math.max(0, loadedFilled - doneItemsForCheckin.reduce((s: number, i: any) => s + (i.filledDropped ?? 0), 0));
  const suggestedEmpty = doneItemsForCheckin.reduce((s: number, i: any) => s + (i.emptyReceived ?? 0), 0);
  const suggestedCash = doneItemsForCheckin.filter((i: any) => i.customer?.paymentType === 'CASH').reduce((s: number, i: any) => s + (i.cashCollected ?? 0), 0);
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
          { label: 'Check-In', active: (hasAnyTrip && !activeTrip) || isClosed, icon: DollarSign },
          { label: 'Closed', active: isClosed, icon: CheckCircle2 },
        ].map((step, i) => (
          <div key={i} className="flex flex-col items-center gap-2">
            <div className={cn(
              'h-8 w-8 sm:h-10 sm:w-10 rounded-full flex items-center justify-center transition-all duration-500',
              step.active ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20' : 'bg-muted text-muted-foreground',
            )}>
              <step.icon className="h-4 w-4 sm:h-5 sm:w-5" />
            </div>
            <span className={cn('text-[9px] sm:text-[10px] font-bold uppercase tracking-tight text-center leading-tight', step.active ? 'text-primary' : 'text-muted-foreground')}>
              {step.label}
            </span>
          </div>
        ))}
      </div>

      {!hasAnyTrip && !isClosed && (
        <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 flex items-start gap-3">
          <span className="text-amber-500 text-lg mt-0.5 flex-shrink-0">⚠</span>
          <div>
            <p className="text-sm font-bold text-amber-700 dark:text-amber-400">No Loadout Recorded</p>
            <p className="text-xs text-muted-foreground mt-0.5">Driver has not started a trip yet. Deliveries cannot be recorded until a trip is started.</p>
          </div>
        </div>
      )}

      {/* Stats Bar */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Card className="bg-card/50 backdrop-blur-sm">
          <CardContent className="p-3 sm:p-4 flex items-center gap-3 sm:gap-4">
            <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary shrink-0">
              <User className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase text-muted-foreground">Driver</p>
              <p className="text-sm font-black truncate">{data?.driver?.name}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card/50 backdrop-blur-sm">
          <CardContent className="p-3 sm:p-4 flex items-center gap-3 sm:gap-4">
            <div className="h-10 w-10 rounded-xl bg-orange-500/10 flex items-center justify-center text-orange-500 shrink-0">
              <Droplets className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase text-muted-foreground">Filled Dropped</p>
              <p className="text-sm font-black truncate">{stats.filledDropped} <span className="text-xs font-normal text-muted-foreground">of {data?.filledOutCount}</span></p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card/50 backdrop-blur-sm">
          <CardContent className="p-3 sm:p-4 flex items-center gap-3 sm:gap-4">
            <div className="h-10 w-10 rounded-xl bg-purple-500/10 flex items-center justify-center text-purple-500 shrink-0">
              <Package className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase text-muted-foreground">Empty Received</p>
              <p className="text-sm font-black truncate">{stats.emptyReceived} <span className="text-xs font-normal text-muted-foreground">bottles</span></p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card/50 backdrop-blur-sm">
          <CardContent className="p-3 sm:p-4 flex items-center gap-3 sm:gap-4">
            <div className="h-10 w-10 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-500 shrink-0">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase text-muted-foreground">Cash Collected</p>
              <p className="text-sm font-black truncate">₨ {stats.cashCollected.toLocaleString()}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card/50 backdrop-blur-sm">
          <CardContent className="p-3 sm:p-4 flex items-center gap-3 sm:gap-4">
            <div className="h-10 w-10 rounded-xl bg-blue-500/10 flex items-center justify-center text-blue-500 shrink-0">
              <Truck className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase text-muted-foreground" title="Bottles loaded but not yet recorded as delivered or returned">Unrecorded</p>
              <p className="text-sm font-black truncate">{bottlesInTruck} bottles</p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card/50 backdrop-blur-sm">
          <CardContent className="p-3 sm:p-4 flex items-center gap-3 sm:gap-4">
            <div className="h-10 w-10 rounded-xl bg-destructive/10 flex items-center justify-center text-destructive shrink-0">
              <Receipt className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase text-muted-foreground">Trip Expenses</p>
              <p className="text-sm font-black text-destructive truncate">
                ₨ {(data?.expenses ?? []).reduce((s, e) => s + e.amount, 0).toLocaleString()}
              </p>
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

      <SheetExpensesSection
        sheetId={sheetId}
        vanId={data?.vanId ?? undefined}
        date={data!.date}
        expenses={data?.expenses ?? []}
        isClosed={isClosed}
        isAdminOrStaff={isAdminOrStaff}
      />

      {/* Ad-hoc / Correction Entry Actions */}
      {isAdminOrStaff && !isClosed && (
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => dispatch({ type: 'OPEN_BULK_IMPORT' })}
            className="gap-2"
          >
            <Upload className="h-4 w-4" />
            Import Deliveries
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => dispatch({ type: 'OPEN_ADHOC' })}
            className="gap-2"
          >
            <Plus className="h-4 w-4" />
            Add Ad-hoc Delivery
          </Button>
        </div>
      )}
      {isAdmin && isClosed && (
        <div className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={() => dispatch({ type: 'OPEN_CORRECTION' })}
            className="gap-2 border-amber-500/50 text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/20"
          >
            <Plus className="h-4 w-4" />
            Add Missed Delivery
          </Button>
        </div>
      )}

      <DeliveryItemsList
        sheetId={sheetId}
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
        onSaveLocation={async (customerId, lat, lng, address) => {
          await updateCustomerLocation.mutateAsync({ customerId, latitude: lat, longitude: lng, address });
        }}
        isDriver={isDriver}
        isAdminOrStaff={isAdminOrStaff}
        onUnlockEdit={(itemId) => unlockDeliveryEdit.mutate({ itemId })}
        unlockingItemId={
          unlockDeliveryEdit.isPending
            ? ((unlockDeliveryEdit.variables as any)?.itemId ?? null)
            : null
        }
        onRequestEdit={(itemId) => requestDeliveryEdit.mutate(itemId)}
        requestingItemId={
          requestDeliveryEdit.isPending
            ? ((requestDeliveryEdit.variables as any) ?? null)
            : null
        }
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
        defaultFilled={items.reduce((sum: number, item: any) => sum + (item.lastFilledDropped ?? 1), 0)}
      />
      <CheckinDialog
        open={ui.checkinOpen}
        onClose={() => dispatch({ type: 'CLOSE_CHECKIN' })}
        sheetId={sheetId}
        trip={activeLoad ?? undefined}
        suggestedValues={{ returnedFilled: suggestedReturned, collectedEmpty: suggestedEmpty, cashHandedIn: suggestedCash }}
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
      <AdhocDeliveryDialog
        open={ui.adhocOpen}
        onClose={() => dispatch({ type: 'CLOSE_ADHOC' })}
        sheetId={sheetId}
      />
      <CorrectionEntryDialog
        open={ui.correctionOpen}
        onClose={() => dispatch({ type: 'CLOSE_CORRECTION' })}
        sheetId={sheetId}
      />
      <BulkImportDialog
        open={ui.bulkImportOpen}
        onClose={() => dispatch({ type: 'CLOSE_BULK_IMPORT' })}
        sheetId={sheetId}
      />
    </div>
  );
}
