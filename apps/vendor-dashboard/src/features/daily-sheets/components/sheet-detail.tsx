'use client';

import { useReducer, useMemo, useEffect, useRef, useState } from 'react';
import { useQueryState, parseAsString } from 'nuqs';
import { Button, Card, CardContent, Input, Skeleton } from '@water-supply-crm/ui';
import { useDailySheet, useUpdateCustomerLocation, useUnlockDeliveryEdit, useRequestDeliveryEdit } from '../hooks/use-daily-sheets';
import { dailySheetsApi } from '../api/daily-sheets.api';
import { CheckinDialog } from './dialogs/checkin-dialog';
import { NewTripDialog } from './dialogs/new-trip-dialog';
import { SwapDialog } from './dialogs/swap-dialog';
import { MoveCustomerDialog } from './dialogs/move-customer-dialog';
import { CrewConfirmDialog } from './dialogs/crew-confirm-dialog';
import { ReconcileDialog } from './dialogs/reconcile-dialog';
import { AdhocDeliveryDialog } from './dialogs/adhoc-delivery-dialog';
import { CorrectionEntryDialog } from './dialogs/correction-entry-dialog';
import { BulkImportDialog } from './dialogs/bulk-import-dialog';
import { toast } from 'sonner';
import {
  CheckCircle2, ClipboardList, DollarSign,
  Droplets, Loader2, Package, Plus, Receipt, RotateCcw, Search, Truck, Upload, User, X,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { cn } from '@water-supply-crm/ui';
import type { DeliveryItem, LoadTrip } from '@water-supply-crm/types';
import { useAuthStore } from '../../../store/auth.store';
import { usePermissions } from '../../authz/hooks/use-permissions';
import { SheetDetailHeader } from './sheet-detail-header';
import { LoadTripsSection } from './load-trips-section';
import { DeliveryItemsList } from './delivery-items-list';
import { SheetExpensesSection } from './sheet-expenses-section';
import { sortBySequence, sortByNearest, sortByCustomerCode } from '../utils/sort-items';
import { useDriverLocation } from '../hooks/use-driver-location';
import { useLocationPublisher } from '../hooks/use-location-publisher';


interface UiState {
  newTripOpen: boolean;
  checkinOpen: string | null;
  swapOpen: boolean;
  crewConfirmOpen: boolean;
  reconcileOpen: boolean;
  adhocOpen: boolean;
  correctionOpen: boolean;
  bulkImportOpen: boolean;
  activeTab: TabKey;
  tabPage: number;
  expandedItemId: string | null;
  /** Deep-linked item awaiting scroll-into-view + highlight (Phase 6). */
  deepLinkItemId: string | null;
}

type UiAction =
  | { type: 'OPEN_NEW_TRIP' }
  | { type: 'CLOSE_NEW_TRIP' }
  | { type: 'OPEN_CHECKIN'; tripId: string }
  | { type: 'CLOSE_CHECKIN' }
  | { type: 'OPEN_SWAP' }
  | { type: 'CLOSE_SWAP' }
  | { type: 'OPEN_CREW_CONFIRM' }
  | { type: 'CLOSE_CREW_CONFIRM' }
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
  | { type: 'SET_EXPANDED'; itemId: string | null }
  | { type: 'START_DEEP_LINK'; itemId: string }
  | { type: 'CLEAR_DEEP_LINK' };

const initialUiState: UiState = {
  newTripOpen: false,
  checkinOpen: null,
  swapOpen: false,
  crewConfirmOpen: false,
  reconcileOpen: false,
  adhocOpen: false,
  correctionOpen: false,
  bulkImportOpen: false,
  activeTab: 'all',
  tabPage: 1,
  expandedItemId: null,
  deepLinkItemId: null,
};

function uiReducer(state: UiState, action: UiAction): UiState {
  switch (action.type) {
    case 'OPEN_NEW_TRIP': return { ...state, newTripOpen: true };
    case 'CLOSE_NEW_TRIP': return { ...state, newTripOpen: false };
    case 'OPEN_CHECKIN': return { ...state, checkinOpen: action.tripId };
    case 'CLOSE_CHECKIN': return { ...state, checkinOpen: null };
    case 'OPEN_SWAP': return { ...state, swapOpen: true, crewConfirmOpen: false };
    case 'CLOSE_SWAP': return { ...state, swapOpen: false };
    case 'OPEN_CREW_CONFIRM': return { ...state, crewConfirmOpen: true };
    case 'CLOSE_CREW_CONFIRM': return { ...state, crewConfirmOpen: false };
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
    case 'START_DEEP_LINK': return { ...state, deepLinkItemId: action.itemId };
    case 'CLEAR_DEEP_LINK': return { ...state, deepLinkItemId: null };
  }
}

interface SheetDetailProps {
  sheetId: string;
}

type TabKey = 'all' | 'pending' | 'completed' | 'issues';
type SortMode = 'sequence' | 'nearest' | 'customerCode';

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
  const { can } = usePermissions();
  const canConfirmCrew = can('daily_sheets:confirm_crew');
  const canSwapAssignment = can('daily_sheets:swap_assignment');
  const canBulkImport = can('daily_sheets:bulk_import');
  const canUpdateSheet = can('daily_sheets:update');
  const canCorrect = can('daily_sheets:correct');
  const canLoadOut = can('daily_sheets:load_out');
  const canCloseSheet = can('daily_sheets:close');
  const canCreateExpense = can('expenses:create');
  const canDeleteExpense = can('expenses:delete');
  const canManageEditLocks = can('daily_sheets:manage_edit_locks');

  const { data, isLoading } = useDailySheet(sheetId);
  const updateCustomerLocation = useUpdateCustomerLocation(sheetId);
  const unlockDeliveryEdit = useUnlockDeliveryEdit(sheetId);
  const requestDeliveryEdit = useRequestDeliveryEdit(sheetId);
  const [ui, dispatch] = useReducer(uiReducer, initialUiState);
  const [sortMode, setSortMode] = useState<SortMode>('sequence');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [moveTargetIds, setMoveTargetIds] = useState<string[] | null>(null);
  const { location: driverLocation, requestLocation } = useDriverLocation();

  // Continuously publish driver GPS to the tracking backend while the sheet is open.
  // Enables live map tracking for the vendor without any manual driver action.
  useLocationPublisher(sheetId, isDriver && !(data?.isClosed ?? true));

  const items = useMemo(() => data?.items ?? [], [data]);

  // Mandatory crew check: auto-open the confirmation dialog the first time a
  // staff/admin opens an open sheet whose crew is not yet confirmed.
  const hasPromptedCrewConfirm = useRef(false);
  useEffect(() => {
    if (!data || hasPromptedCrewConfirm.current) return;
    if (canConfirmCrew && !data.isClosed && !data.crewConfirmed) {
      hasPromptedCrewConfirm.current = true;
      dispatch({ type: 'OPEN_CREW_CONFIRM' });
    }
  }, [data, canConfirmCrew]);

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
  // Selection is scoped to the active tab's list — clear it if the tab changes underneath it.
  useEffect(() => {
    setSelectMode(false);
    setSelectedIds(new Set());
  }, [ui.activeTab]);

  const loads = useMemo(() => data?.loads ?? [], [data]);
  const doneItems = useMemo(
    () => items.filter((i) => i.status === 'COMPLETED' || i.status === 'EMPTY_ONLY'),
    [items],
  );
  const stats = useMemo(() => ({
    filledDropped: doneItems.reduce((acc, i) => acc + i.filledDropped, 0),
    emptyReceived: doneItems.reduce((acc, i) => acc + i.emptyReceived, 0),
    filledReceived: doneItems.reduce((acc, i) => acc + i.filledReceived, 0),
    cashCollected: doneItems.reduce((acc, i) => acc + i.cashCollected, 0),
  }), [doneItems]);
  const sortedItems = useMemo(() => {
    if (sortMode === 'nearest' && driverLocation.status === 'success') {
      return sortByNearest(items, driverLocation.lat, driverLocation.lng);
    }
    if (sortMode === 'customerCode') {
      return sortByCustomerCode(items);
    }
    return sortBySequence(items);
  }, [items, sortMode, driverLocation]);

  // Deep link from the Communication Center's "Open Delivery" button (Phase 6,
  // docs/features/customer-communication-center.md §6.1). Locates the item,
  // switches to the 'all' tab (only tab guaranteed to contain any item),
  // computes its page within that tab, expands it, and arms the highlight —
  // DeliveryItemsList performs the actual scroll/highlight once the row is
  // rendered on the matched page and clears the param when done (see its
  // onDeepLinkComplete callback below). A stale search query would otherwise
  // hide an item that genuinely exists, so it's cleared here too.
  const [itemParam, setItemParam] = useQueryState('item', parseAsString.withDefault(''));
  useEffect(() => {
    if (!data || !itemParam) return;
    const target = items.find((i) => i.id === itemParam);
    if (!target) {
      toast.error('Delivery not found on this sheet');
      setItemParam(null);
      return;
    }
    if (searchQuery) setSearchQuery('');
    const targetIndex = sortedItems.findIndex((i) => i.id === itemParam);
    const targetPage = Math.floor(Math.max(0, targetIndex) / ITEMS_PER_PAGE) + 1;
    dispatch({ type: 'SET_TAB', tab: 'all' });
    dispatch({ type: 'SET_PAGE', page: targetPage });
    dispatch({ type: 'SET_EXPANDED', itemId: target.id });
    dispatch({ type: 'START_DEEP_LINK', itemId: target.id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, itemParam]);

  const searchFilteredItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return sortedItems;
    return sortedItems.filter((i) =>
      i.customer?.name?.toLowerCase().includes(query) ||
      i.customer?.customerCode?.toLowerCase().includes(query),
    );
  }, [sortedItems, searchQuery]);

  const filteredItems = useMemo(
    () => searchFilteredItems.filter((i) => tabFilter(ui.activeTab, i)),
    [searchFilteredItems, ui.activeTab],
  );
  const totalPages = useMemo(() => Math.max(1, Math.ceil(filteredItems.length / ITEMS_PER_PAGE)), [filteredItems]);
  const paginatedItems = useMemo(
    () => filteredItems.slice((ui.tabPage - 1) * ITEMS_PER_PAGE, ui.tabPage * ITEMS_PER_PAGE),
    [filteredItems, ui.tabPage],
  );

  const coordsAvailableCount = useMemo(
    () => items.filter((i) => i.customer?.latitude != null && i.customer?.longitude != null).length,
    [items],
  );
  const missingCoordsCount = useMemo(
    () => (sortMode !== 'nearest' ? 0 : items.length - coordsAvailableCount),
    [items, sortMode, coordsAvailableCount],
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
  // Filled bottles received back from customers physically re-enter the van's
  // stock too — add them back or "Unrecorded" would falsely look understocked.
  const bottlesInTruck = Math.max(0, (data?.filledOutCount ?? 0) - stats.filledDropped + stats.filledReceived);

  // Pre-fill values for check-in dialog
  const activeLoad = data?.loads?.find((l: any) => !l.endedAt);
  const loadedFilled = activeLoad?.loadedFilled ?? 0;
  const doneItemsForCheckin = (data?.items ?? []).filter((i: any) => ['COMPLETED', 'EMPTY_ONLY'].includes(i.status));
  const suggestedReturned = Math.max(0, loadedFilled - doneItemsForCheckin.reduce((s: number, i: any) => s + (i.filledDropped ?? 0), 0));
  const suggestedEmpty = doneItemsForCheckin.reduce((s: number, i: any) => s + (i.emptyReceived ?? 0), 0);
  const suggestedCash = doneItemsForCheckin.filter((i: any) => i.customer?.paymentType === 'CASH').reduce((s: number, i: any) => s + (i.cashCollected ?? 0), 0);
  const tabCount = (tab: TabKey) => searchFilteredItems.filter((i) => tabFilter(tab, i)).length;

  const handleSortModeChange = (mode: SortMode) => {
    setSortMode(mode);
    dispatch({ type: 'SET_PAGE', page: 1 });
    if (mode === 'nearest' && driverLocation.status === 'idle') {
      requestLocation();
    }
  };

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    dispatch({ type: 'SET_PAGE', page: 1 });
  };

  const handleToggleSelectMode = () => {
    setSelectMode((v) => !v);
    setSelectedIds(new Set());
  };

  const handleToggleSelected = (itemId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  const handleMoveClose = () => setMoveTargetIds(null);

  const handleMoved = () => {
    setMoveTargetIds(null);
    setSelectMode(false);
    setSelectedIds(new Set());
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
      <SheetDetailHeader
        date={data!.date}
        routeName={data?.route?.name ?? null}
        vanPlateNumber={data?.van?.plateNumber ?? null}
        driverName={data?.driver?.name ?? null}
        crew={data?.crew ?? []}
        crewConfirmed={!!data?.crewConfirmed}
        crewConfirmedByName={data?.crewConfirmedBy?.name ?? null}
        currentStatus={currentStatus}
        isClosed={isClosed}
        canEditCrew={canSwapAssignment}
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

      {!data.crewConfirmed && !isClosed && (
        <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 flex items-center gap-3 flex-wrap">
          <span className="text-amber-500 text-lg flex-shrink-0">⚠</span>
          <div className="flex-1 min-w-[200px]">
            <p className="text-sm font-bold text-amber-700 dark:text-amber-400">Crew Not Confirmed</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Today&apos;s crew must be confirmed before a trip can start.
            </p>
          </div>
          {canConfirmCrew && (
            <Button
              size="sm"
              className="rounded-full font-bold"
              onClick={() => dispatch({ type: 'OPEN_CREW_CONFIRM' })}
            >
              Review &amp; Confirm
            </Button>
          )}
        </div>
      )}

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
            <div className="h-10 w-10 rounded-xl bg-sky-500/10 flex items-center justify-center text-sky-500 shrink-0">
              <RotateCcw className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase text-muted-foreground">Filled Received</p>
              <p className="text-sm font-black truncate">{stats.filledReceived} <span className="text-xs font-normal text-muted-foreground">bottles</span></p>
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
        canLoadOut={canLoadOut}
        canClose={canCloseSheet}
        onNewTrip={() => {
          // Backend also enforces this — trips cannot start with an unconfirmed crew
          if (!data.crewConfirmed) {
            toast.warning('Confirm today’s crew before starting a trip');
            dispatch({ type: 'OPEN_CREW_CONFIRM' });
            return;
          }
          dispatch({ type: 'OPEN_NEW_TRIP' });
        }}
        onReconcile={() => dispatch({ type: 'OPEN_RECONCILE' })}
        onCheckin={(tripId) => dispatch({ type: 'OPEN_CHECKIN', tripId })}
      />

      <SheetExpensesSection
        sheetId={sheetId}
        vanId={data?.vanId ?? undefined}
        date={data!.date}
        expenses={data?.expenses ?? []}
        isClosed={isClosed}
        canCreate={canCreateExpense}
        canDelete={canDeleteExpense}
      />

      {/* Ad-hoc / Correction Entry Actions */}
      {(canBulkImport || canUpdateSheet) && !isClosed && (
        <div className="flex justify-end gap-2">
          {canBulkImport && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => dispatch({ type: 'OPEN_BULK_IMPORT' })}
              className="gap-2"
            >
              <Upload className="h-4 w-4" />
              Import Deliveries
            </Button>
          )}
          {canUpdateSheet && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => dispatch({ type: 'OPEN_ADHOC' })}
              className="gap-2"
            >
              <Plus className="h-4 w-4" />
              Add Ad-hoc Delivery
            </Button>
          )}
        </div>
      )}
      {canCorrect && isClosed && (
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

      {/* Search + Sort Controls */}
      <div className="space-y-2">
        <div className="relative group max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
          <Input
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Search customer name or code..."
            className="pl-9 pr-9 w-full rounded-xl bg-background/50 border-border/50 focus:ring-primary/20 transition-all"
          />
          {searchQuery && (
            <button
              onClick={() => handleSearchChange('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded-md hover:bg-muted text-muted-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Sort</span>
          <div className="flex rounded-xl border border-border/50 overflow-hidden divide-x divide-border/50">
            {([
              { mode: 'sequence' as SortMode, label: 'Sheet Order' },
              { mode: 'nearest' as SortMode, label: 'Nearest First' },
              { mode: 'customerCode' as SortMode, label: 'Customer Code' },
            ] as const).map(({ mode, label }) => (
              <button
                key={mode}
                onClick={() => handleSortModeChange(mode)}
                className={cn(
                  'px-3 py-1.5 text-xs font-bold transition-colors',
                  sortMode === mode
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-background text-muted-foreground hover:bg-muted',
                )}
              >
                {mode === 'nearest' && driverLocation.status === 'loading' ? (
                  <span className="flex items-center gap-1.5">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Locating…
                  </span>
                ) : (
                  label
                )}
              </button>
            ))}
          </div>
          {items.length > 0 && (
            <span className="text-[10px] text-muted-foreground">
              {coordsAvailableCount}/{items.length} with location
            </span>
          )}
        </div>

        {sortMode === 'nearest' && driverLocation.status === 'error' && (
          <p className="text-xs text-destructive font-medium">
            {driverLocation.message} — Enable location access in your browser settings.
          </p>
        )}

        {sortMode === 'nearest' && missingCoordsCount > 0 && (
          <p className="text-[11px] text-muted-foreground">
            {missingCoordsCount} customer{missingCoordsCount > 1 ? 's have' : ' has'} no saved
            coordinates and {missingCoordsCount > 1 ? 'appear' : 'appears'} at the end.
          </p>
        )}
      </div>

      <DeliveryItemsList
        sheetId={sheetId}
        collectionPolicy={data?.collectionPolicy}
        cashCollectionPolicy={data?.cashCollectionPolicy}
        items={items}
        paginatedItems={paginatedItems}
        filteredItems={filteredItems}
        activeTab={ui.activeTab}
        tabPage={ui.tabPage}
        totalPages={totalPages}
        expandedItemId={ui.expandedItemId}
        deepLinkItemId={ui.deepLinkItemId}
        onDeepLinkComplete={() => { dispatch({ type: 'CLEAR_DEEP_LINK' }); setItemParam(null); }}
        isClosed={isClosed}
        tabCount={tabCount}
        onTabChange={(tab) => dispatch({ type: 'SET_TAB', tab: tab as TabKey })}
        onPageChange={(page) => dispatch({ type: 'SET_PAGE', page })}
        onToggleExpand={(itemId) => dispatch({ type: 'SET_EXPANDED', itemId })}
        onSaveLocation={async (customerId, lat, lng, address) => {
          await updateCustomerLocation.mutateAsync({ customerId, latitude: lat, longitude: lng, address });
        }}
        isDriver={isDriver}
        canManageEditLocks={canManageEditLocks}
        canUpdate={canUpdateSheet}
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
        selectMode={selectMode}
        onToggleSelectMode={handleToggleSelectMode}
        selectedIds={selectedIds}
        onToggleSelected={handleToggleSelected}
        onMoveItem={(itemId) => setMoveTargetIds([itemId])}
        onMoveSelected={() => setMoveTargetIds(Array.from(selectedIds))}
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
        currentCrew={data?.crew ?? []}
        // Editing resets the confirmation — bring the user straight back to confirm
        onSaved={() => { if (!isClosed) dispatch({ type: 'OPEN_CREW_CONFIRM' }); }}
      />
      <CrewConfirmDialog
        open={ui.crewConfirmOpen}
        onClose={() => dispatch({ type: 'CLOSE_CREW_CONFIRM' })}
        sheetId={sheetId}
        driverName={data?.driver?.name ?? null}
        crew={data?.crew ?? []}
        onEditCrew={() => dispatch({ type: 'OPEN_SWAP' })}
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
      <MoveCustomerDialog
        open={!!moveTargetIds}
        onClose={handleMoveClose}
        sheetId={sheetId}
        sourceDate={data!.date}
        sourceVanId={data?.vanId}
        items={(moveTargetIds ?? []).map((id) => {
          const item = items.find((i) => i.id === id);
          return { id, customerName: item?.customer?.name ?? 'Customer' };
        })}
        onMoved={handleMoved}
      />
    </div>
  );
}
