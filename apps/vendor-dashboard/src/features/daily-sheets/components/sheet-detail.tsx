'use client';

import { useReducer, useMemo, useEffect, useRef, useState } from 'react';
import { useQueryState, parseAsString } from 'nuqs';
import { Button, Card, CardContent, Input, Skeleton } from '@water-supply-crm/ui';
import { useDailySheet, useUpdateCustomerLocation, useUnlockDeliveryEdit, useRequestDeliveryEdit, useUnlockTripEdit, useRequestTripEdit } from '../hooks/use-daily-sheets';
import { dailySheetsApi } from '../api/daily-sheets.api';
import { CheckinDialog } from './dialogs/checkin-dialog';
import { NewTripDialog } from './dialogs/new-trip-dialog';
import { SwapDialog } from './dialogs/swap-dialog';
import { MoveCustomerDialog } from './dialogs/move-customer-dialog';
import { CrewConfirmDialog } from './dialogs/crew-confirm-dialog';
import { ReconcileDialog } from './dialogs/reconcile-dialog';
import { RejectCloseDialog } from './dialogs/reject-close-dialog';
import { AdhocDeliveryDialog } from './dialogs/adhoc-delivery-dialog';
import { CorrectionEntryDialog } from './dialogs/correction-entry-dialog';
import { VoidDeliveryDialog } from './dialogs/void-delivery-dialog';
import { BulkImportDialog } from './dialogs/bulk-import-dialog';
import { ReportDamageDialog } from './dialogs/report-damage-dialog';
import { VehicleCheckDialog } from '../../fleet/components/dialogs/vehicle-check-dialog';
import { VehicleCheckEditDialog } from '../../fleet/components/dialogs/vehicle-check-edit-dialog';
import { CriticalOverrideDialog } from '../../fleet/components/dialogs/critical-override-dialog';
import { FuelLogFormDialog } from '../../fleet/components/dialogs/fuel-log-form-dialog';
import { useVehicleDailyChecks } from '../../fleet/hooks/use-vehicle-checks';
import { toast } from 'sonner';
import {
  CheckCircle2, ChevronDown, ChevronUp, ClipboardList, DollarSign, Gauge, ShieldAlert,
  Droplets, Loader2, Package, Pencil, Receipt, Route, RotateCcw, Search, Truck, Upload, User, X,
  AlertOctagon, ArrowRightLeft, XCircle,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { VehicleCheckType } from '@water-supply-crm/types';
import { useRouter } from 'next/navigation';
import { cn } from '@water-supply-crm/ui';
import type { DeliveryItem, DeliveryItemMoveLogEntry, LoadTrip, VehicleDailyCheckEntry } from '@water-supply-crm/types';
import { useAuthStore } from '../../../store/auth.store';
import { usePermissions } from '../../authz/hooks/use-permissions';
import { SheetDetailHeader } from './sheet-detail-header';
import { LoadTripsSection } from './load-trips-section';
import { DeliveryItemsList } from './delivery-items-list';
import { SheetCashOutSection } from './sheet-cash-out-section';
import { AddRecordMenu } from './add-record-menu';
import { ExpenseForm } from '../../expenses/components/expense-form';
import { CrewCashForm } from '../../crew-cash/components/crew-cash-form';
import { sortBySequence, sortByNearest, sortByCustomerCode } from '../utils/sort-items';
import { useDriverLocation } from '../hooks/use-driver-location';
import { useLocationPublisher } from '../hooks/use-location-publisher';
import { useDiscrepancyCases } from '../../discrepancy-cases/hooks/use-discrepancy-cases';


interface UiState {
  newTripOpen: boolean;
  checkinOpen: string | null;
  /** Trip Edit-Unlock — the load id currently being re-edited (post check-in). */
  editTripOpen: string | null;
  swapOpen: boolean;
  crewConfirmOpen: boolean;
  reconcileOpen: boolean;
  // Soft Close (Amendment R9) — Staff/Admin rejecting a self-close request.
  rejectCloseOpen: boolean;
  adhocOpen: boolean;
  correctionOpen: boolean;
  bulkImportOpen: boolean;
  // Fleet Operations Phase 1 (docs/features/fleet-operations-vehicle-intelligence.md).
  vehicleCheckOpen: VehicleCheckType | null;
  // Odometer Correction (2026-08-23) — the check being corrected, or null.
  editVehicleCheckOpen: VehicleDailyCheckEntry | null;
  criticalOverrideOpen: boolean;
  fuelLogOpen: boolean;
  // Unified "+ Add / Record" launcher (mirrors fuelLogOpen's pattern exactly).
  expenseOpen: boolean;
  crewCashOpen: boolean;
  damageOpen: boolean;
  activeTab: TabKey;
  tabPage: number;
  expandedItemId: string | null;
  /** Deep-linked item awaiting scroll-into-view + highlight (Phase 6). */
  deepLinkItemId: string | null;
  /** Delivery Queue's trip filter dropdown — 'all' (default, no-op) or a DailySheetLoad id. */
  tripFilter: string;
}

type UiAction =
  | { type: 'OPEN_NEW_TRIP' }
  | { type: 'CLOSE_NEW_TRIP' }
  | { type: 'OPEN_CHECKIN'; tripId: string }
  | { type: 'CLOSE_CHECKIN' }
  | { type: 'OPEN_EDIT_TRIP'; tripId: string }
  | { type: 'CLOSE_EDIT_TRIP' }
  | { type: 'OPEN_SWAP' }
  | { type: 'CLOSE_SWAP' }
  | { type: 'OPEN_CREW_CONFIRM' }
  | { type: 'CLOSE_CREW_CONFIRM' }
  | { type: 'OPEN_RECONCILE' }
  | { type: 'CLOSE_RECONCILE' }
  | { type: 'OPEN_REJECT_CLOSE' }
  | { type: 'CLOSE_REJECT_CLOSE' }
  | { type: 'OPEN_ADHOC' }
  | { type: 'CLOSE_ADHOC' }
  | { type: 'OPEN_CORRECTION' }
  | { type: 'CLOSE_CORRECTION' }
  | { type: 'OPEN_BULK_IMPORT' }
  | { type: 'CLOSE_BULK_IMPORT' }
  | { type: 'OPEN_VEHICLE_CHECK'; checkType: VehicleCheckType }
  | { type: 'CLOSE_VEHICLE_CHECK' }
  | { type: 'OPEN_EDIT_VEHICLE_CHECK'; check: VehicleDailyCheckEntry }
  | { type: 'CLOSE_EDIT_VEHICLE_CHECK' }
  | { type: 'OPEN_CRITICAL_OVERRIDE' }
  | { type: 'CLOSE_CRITICAL_OVERRIDE' }
  | { type: 'OPEN_FUEL_LOG' }
  | { type: 'CLOSE_FUEL_LOG' }
  | { type: 'OPEN_EXPENSE' }
  | { type: 'CLOSE_EXPENSE' }
  | { type: 'OPEN_CREW_CASH' }
  | { type: 'CLOSE_CREW_CASH' }
  | { type: 'OPEN_DAMAGE' }
  | { type: 'CLOSE_DAMAGE' }
  | { type: 'SET_TAB'; tab: TabKey }
  | { type: 'SET_PAGE'; page: number }
  | { type: 'SET_EXPANDED'; itemId: string | null }
  | { type: 'START_DEEP_LINK'; itemId: string }
  | { type: 'CLEAR_DEEP_LINK' }
  | { type: 'SET_TRIP_FILTER'; tripId: string };

const initialUiState: UiState = {
  newTripOpen: false,
  checkinOpen: null,
  editTripOpen: null,
  swapOpen: false,
  crewConfirmOpen: false,
  reconcileOpen: false,
  rejectCloseOpen: false,
  adhocOpen: false,
  correctionOpen: false,
  bulkImportOpen: false,
  vehicleCheckOpen: null,
  editVehicleCheckOpen: null,
  criticalOverrideOpen: false,
  fuelLogOpen: false,
  expenseOpen: false,
  crewCashOpen: false,
  damageOpen: false,
  activeTab: 'all',
  tabPage: 1,
  expandedItemId: null,
  deepLinkItemId: null,
  tripFilter: 'all',
};

function uiReducer(state: UiState, action: UiAction): UiState {
  switch (action.type) {
    case 'OPEN_NEW_TRIP': return { ...state, newTripOpen: true };
    case 'CLOSE_NEW_TRIP': return { ...state, newTripOpen: false };
    case 'OPEN_CHECKIN': return { ...state, checkinOpen: action.tripId };
    case 'CLOSE_CHECKIN': return { ...state, checkinOpen: null };
    case 'OPEN_EDIT_TRIP': return { ...state, editTripOpen: action.tripId };
    case 'CLOSE_EDIT_TRIP': return { ...state, editTripOpen: null };
    case 'OPEN_SWAP': return { ...state, swapOpen: true, crewConfirmOpen: false };
    case 'CLOSE_SWAP': return { ...state, swapOpen: false };
    case 'OPEN_CREW_CONFIRM': return { ...state, crewConfirmOpen: true };
    case 'CLOSE_CREW_CONFIRM': return { ...state, crewConfirmOpen: false };
    case 'OPEN_RECONCILE': return { ...state, reconcileOpen: true };
    case 'CLOSE_RECONCILE': return { ...state, reconcileOpen: false };
    case 'OPEN_REJECT_CLOSE': return { ...state, rejectCloseOpen: true };
    case 'CLOSE_REJECT_CLOSE': return { ...state, rejectCloseOpen: false };
    case 'OPEN_ADHOC': return { ...state, adhocOpen: true };
    case 'CLOSE_ADHOC': return { ...state, adhocOpen: false };
    case 'OPEN_CORRECTION': return { ...state, correctionOpen: true };
    case 'CLOSE_CORRECTION': return { ...state, correctionOpen: false };
    case 'OPEN_BULK_IMPORT': return { ...state, bulkImportOpen: true };
    case 'CLOSE_BULK_IMPORT': return { ...state, bulkImportOpen: false };
    case 'OPEN_VEHICLE_CHECK': return { ...state, vehicleCheckOpen: action.checkType };
    case 'CLOSE_VEHICLE_CHECK': return { ...state, vehicleCheckOpen: null };
    case 'OPEN_EDIT_VEHICLE_CHECK': return { ...state, editVehicleCheckOpen: action.check };
    case 'CLOSE_EDIT_VEHICLE_CHECK': return { ...state, editVehicleCheckOpen: null };
    case 'OPEN_CRITICAL_OVERRIDE': return { ...state, criticalOverrideOpen: true };
    case 'CLOSE_CRITICAL_OVERRIDE': return { ...state, criticalOverrideOpen: false };
    case 'OPEN_FUEL_LOG': return { ...state, fuelLogOpen: true };
    case 'CLOSE_FUEL_LOG': return { ...state, fuelLogOpen: false };
    case 'OPEN_EXPENSE': return { ...state, expenseOpen: true };
    case 'CLOSE_EXPENSE': return { ...state, expenseOpen: false };
    case 'OPEN_CREW_CASH': return { ...state, crewCashOpen: true };
    case 'CLOSE_CREW_CASH': return { ...state, crewCashOpen: false };
    case 'OPEN_DAMAGE': return { ...state, damageOpen: true };
    case 'CLOSE_DAMAGE': return { ...state, damageOpen: false };
    case 'SET_TAB': return { ...state, activeTab: action.tab, tabPage: 1, expandedItemId: null };
    case 'SET_PAGE': return { ...state, tabPage: action.page };
    case 'SET_EXPANDED': return { ...state, expandedItemId: action.itemId };
    case 'START_DEEP_LINK': return { ...state, deepLinkItemId: action.itemId };
    case 'CLEAR_DEEP_LINK': return { ...state, deepLinkItemId: null };
    // Same tabPage reset as SET_TAB — switching trips shouldn't leave the
    // user stranded on a page number that no longer exists for the new list.
    case 'SET_TRIP_FILTER': return { ...state, tripFilter: action.tripId, tabPage: 1 };
  }
}

interface SheetDetailProps {
  sheetId: string;
}

// 'moved_out' is NOT a status filter over `items` like the other four — it's
// a completely separate source (data.movedOutLogs), handled outside this
// function; see movedOutItems/tabFilter's call sites below.
type TabKey = 'all' | 'pending' | 'completed' | 'issues' | 'moved_out' | 'voided';
type SortMode = 'sequence' | 'nearest' | 'customerCode';

const ITEMS_PER_PAGE = 20;

function tabFilter(tab: TabKey, item: DeliveryItem): boolean {
  switch (tab) {
    case 'pending': return item.status === 'PENDING';
    case 'completed': return item.status === 'COMPLETED' || item.status === 'EMPTY_ONLY';
    case 'issues': return item.status === 'RESCHEDULED' || item.status === 'CANCELLED' || item.status === 'NOT_AVAILABLE';
    case 'voided': return item.status === 'VOIDED';
    case 'moved_out': return false; // never matched here — moved_out bypasses this pipeline entirely
    // 'all' — voided stops are struck from the record, so they leave the default list
    // and only appear under their own dedicated tab.
    default: return item.status !== 'VOIDED';
  }
}

export function SheetDetail({ sheetId }: SheetDetailProps) {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const isDriver = user?.role === 'DRIVER';
  const { can } = usePermissions();
  const canConfirmCrew = can('daily_sheets:confirm_crew');
  const canSwapAssignment = can('daily_sheets:swap_assignment');
  // Was previously gated by `!isDriver` (hardcoded role check) — switched to the
  // RBAC permission so an admin can grant PDF export to the driver role via
  // Roles & Access Control, same as every other daily_sheets action.
  const canExport = can('daily_sheets:export');
  const canBulkImport = can('daily_sheets:bulk_import');
  const canUpdateSheet = can('daily_sheets:update');
  // Amendment R10: split out of daily_sheets:update — independently grantable
  // per role so Move can be restricted without also restricting delivery updates.
  const canMoveCustomer = can('daily_sheets:move_customer');
  const canVoidDelivery = can('daily_sheets:void_delivery');
  const canCorrect = can('daily_sheets:correct');
  const canLoadOut = can('daily_sheets:load_out');
  const canCloseSheet = can('daily_sheets:close');
  // Soft Close (Amendment R9).
  const canRequestClose = can('daily_sheets:request_close');
  const canApproveClose = can('daily_sheets:approve_close');
  const canRejectClose = can('daily_sheets:reject_close');
  const canCreateExpense = can('expenses:create');
  const canDeleteExpense = can('expenses:delete');
  const canUpdateExpense = can('expenses:update');
  const canManageEditLocks = can('daily_sheets:manage_edit_locks');
  const canCreateCrewCash = can('crew_cash:create');
  const canEditAllCrewCash = can('crew_cash:edit');
  const canDeleteAllCrewCash = can('crew_cash:delete');
  // Fleet Operations Phase 1.
  const canRecordVehicleCheck = can('fleet:record_check');
  const canRecordFuel = can('fleet:record_fuel');
  const canOverrideCriticalCheck = can('fleet:override_check');
  // Odometer Correction (2026-08-23) — deliberately fleet:update, not
  // fleet:record_check: a Driver can submit a check but not silently rewrite
  // one after the fact, same boundary as every other Fleet correction path.
  const canEditVehicleCheck = can('fleet:update');
  const canReportDamage = can('damage_cases:create');

  const { data, isLoading } = useDailySheet(sheetId);
  const { data: vehicleChecks } = useVehicleDailyChecks(sheetId);
  const startCheck = vehicleChecks?.find((c) => c.checkType === 'START') ?? null;
  const endCheck = vehicleChecks?.find((c) => c.checkType === 'END') ?? null;
  const unresolvedCriticalCheck = startCheck?.hasCriticalFailure && !startCheck.criticalOverrideById ? startCheck : null;
  // Km traveled today — plain odometer delta between the two vehicle checks,
  // deliberately independent of fuel/efficiency data (see FuelLog for that).
  // null = not calculable yet (a check is missing); negative deltas are
  // surfaced as an anomaly instead of a nonsense negative distance — the
  // backend already flags this same condition on the END check via
  // odometerContinuityFlag (vehicle-check.service.ts).
  const kmTraveledToday = startCheck && endCheck ? endCheck.odometerReading - startCheck.odometerReading : null;
  const kmTraveledIsAnomaly = kmTraveledToday !== null && kmTraveledToday < 0;
  const updateCustomerLocation = useUpdateCustomerLocation(sheetId);
  const unlockDeliveryEdit = useUnlockDeliveryEdit(sheetId);
  const requestDeliveryEdit = useRequestDeliveryEdit(sheetId);
  const unlockTripEdit = useUnlockTripEdit(sheetId);
  const requestTripEdit = useRequestTripEdit(sheetId);
  const [ui, dispatch] = useReducer(uiReducer, initialUiState);
  const [sortMode, setSortMode] = useState<SortMode>('sequence');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectMode, setSelectMode] = useState(false);
  // Customer Move/Transfer footprint banner — collapsed by default, matches
  // CustomerHistorySection's own toggle pattern.
  const [movedOutExpanded, setMovedOutExpanded] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [moveTargetIds, setMoveTargetIds] = useState<string[] | null>(null);
  const [voidTargetItem, setVoidTargetItem] = useState<DeliveryItem | null>(null);
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

  // Vehicle daily check: auto-open the start-of-day check right after crew
  // confirmation, once per mount — mirrors hasPromptedCrewConfirm exactly.
  // A missing (or critically-failed-and-unacknowledged) check is now a hard
  // 409 block on trip start (see assertTripStartClear in vehicle-check.service.ts),
  // same tier as crewConfirmed; this effect is just the proactive nudge so the
  // driver sees it before hitting the block on "New Trip". Also backed by the
  // persistent "Vehicle Check Not Recorded" banner + onNewTrip gate below, so
  // closing this dialog without submitting doesn't lose the requirement.
  const hasPromptedVehicleCheck = useRef(false);
  useEffect(() => {
    if (!data || !vehicleChecks || hasPromptedVehicleCheck.current) return;
    if (canRecordVehicleCheck && !data.isClosed && data.crewConfirmed && !startCheck) {
      hasPromptedVehicleCheck.current = true;
      dispatch({ type: 'OPEN_VEHICLE_CHECK', checkType: 'START' });
    }
  }, [data, vehicleChecks, canRecordVehicleCheck, startCheck]);

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
  // Customer Move/Transfer footprint (destination side) — keyed by itemId so
  // delivery-items-list.tsx can render a "MOVED IN" badge per row via a plain
  // lookup instead of scanning the array on every item.
  const movedInByItemId = useMemo(() => {
    const map = new Map<string, DeliveryItemMoveLogEntry>();
    for (const log of data?.movedInLogs ?? []) map.set(log.itemId, log);
    return map;
  }, [data?.movedInLogs]);
  // Trip-level Deliveries/Expenses/Expected Cash chips (load-trips-section.tsx) —
  // groups the sheet's items/expenses by the trip they were recorded during
  // (DailySheetItem.dailySheetLoadId / Expense.dailySheetLoadId, null = no
  // active trip at record time, excluded here since it has no trip card to
  // render against). Deliveries use the same terminal-status filter as
  // doneItemsForCheckin/doneItems ('COMPLETED' | 'EMPTY_ONLY') so cashCollected
  // is only counted once a delivery is actually final; expenses only count the
  // deductible subset (paidFromCash !== false) that actually reduces cash on hand.
  // `items` carries the actual matched rows too (not just the aggregate) so the
  // trip card's "View Deliveries" toggle can list them without a second fetch.
  const tripStats = useMemo(() => {
    const map: Record<string, { deliveryCount: number; deliveriesCash: number; expensesTotal: number; expectedCash: number; items: DeliveryItem[] }> = {};
    // Cash no longer hands over per-trip (single day-end entry, see Reconcile
    // dialog) — the driver just keeps carrying it forward. So "Expected Cash"
    // on trip N must be the RUNNING total through trip N (every trip's own
    // net, summed in order), not trip N's isolated net — that isolated figure
    // alone would understate what the driver should actually be holding by
    // that point. Deliveries/Expenses stay per-trip (what happened THIS
    // trip); only Expected Cash accumulates. Sorted defensively — the backend
    // already orders loads by tripNumber ascending, but the running total
    // depends on that order, so don't silently trust it.
    const orderedTrips = [...loads].sort((a, b) => a.tripNumber - b.tripNumber);
    let cumulativeExpectedCash = 0;
    for (const trip of orderedTrips) {
      const tripItems = (data?.items ?? []).filter(
        (i) => i.dailySheetLoadId === trip.id && (i.status === 'COMPLETED' || i.status === 'EMPTY_ONLY'),
      );
      const tripExpenses = (data?.expenses ?? []).filter(
        (e) => e.dailySheetLoadId === trip.id && e.paidFromCash !== false,
      );
      // Crew Cash has no paidFromCash toggle — it's unconditionally physical
      // van cash (see the schema comment on CrewCashDistribution's own
      // dailySheetLoadId), so every row linked to this trip counts, same
      // bucket as the cash-paid expenses above.
      const tripCrewCash = (data?.crewCashDistributions ?? []).filter(
        (c) => c.dailySheetLoadId === trip.id,
      );
      const deliveryCount = tripItems.length;
      const deliveriesCash = tripItems.reduce((s, i) => s + i.cashCollected, 0);
      const expensesTotal =
        tripExpenses.reduce((s, e) => s + e.amount, 0) +
        tripCrewCash.reduce((s, c) => s + c.amount, 0);
      cumulativeExpectedCash += deliveriesCash - expensesTotal;
      map[trip.id] = { deliveryCount, deliveriesCash, expensesTotal, expectedCash: cumulativeExpectedCash, items: tripItems };
    }
    return map;
  }, [loads, data?.items, data?.expenses, data?.crewCashDistributions]);
  // Today's confirmed crew — driver plus DailySheetCrew rows — the only pool the
  // Crew Cash Distribution employee picker (and its list's name lookup) may draw from.
  const crewCashEmployees = useMemo(() => {
    const members: { id: string; name: string }[] = [];
    if (data?.driver) members.push({ id: data.driver.id, name: data.driver.name });
    for (const c of data?.crew ?? []) {
      if (!members.some((m) => m.id === c.userId)) members.push({ id: c.userId, name: c.user.name });
    }
    return members;
  }, [data]);
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

  // Trip filter (the dropdown next to Delivery Queue, driven by Load Trips'
  // per-trip "View Deliveries" story) — narrows the queue to one trip's
  // deliveries via the same dailySheetLoadId FK the Trip Cards use, so this
  // list and the cards never disagree. 'all' (default) is a no-op.
  const tripFilteredItems = useMemo(() => {
    if (ui.tripFilter === 'all') return searchFilteredItems;
    return searchFilteredItems.filter((i) => i.dailySheetLoadId === ui.tripFilter);
  }, [searchFilteredItems, ui.tripFilter]);

  // Moved Out tab — NOT part of `items` at all (those rows no longer belong
  // to this sheet, their dailySheetId points elsewhere); sourced straight
  // from data.movedOutLogs's full `item` payload (backend attaches it
  // specifically for this), with move context (moveInfo) merged on so the
  // shared delivery card can show "-> Van X ...". Search still applies, same
  // as every other tab; trip filter deliberately does not (these items no
  // longer have a trip on THIS sheet).
  const movedOutItems = useMemo(() => {
    return (data?.movedOutLogs ?? [])
      .filter((log) => !!log.item)
      .map((log) => ({
        ...log.item!,
        moveInfo: { otherSheet: log.otherSheet, movedBy: log.movedBy, movedAt: log.movedAt },
      }));
  }, [data?.movedOutLogs]);

  const searchFilteredMovedOutItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return movedOutItems;
    return movedOutItems.filter((i) =>
      i.customer?.name?.toLowerCase().includes(query) ||
      i.customer?.customerCode?.toLowerCase().includes(query),
    );
  }, [movedOutItems, searchQuery]);

  const filteredItems = useMemo(
    () => ui.activeTab === 'moved_out'
      ? searchFilteredMovedOutItems
      : tripFilteredItems.filter((i) => tabFilter(ui.activeTab, i)),
    [tripFilteredItems, ui.activeTab, searchFilteredMovedOutItems],
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

  // Post-close reconciliation gaps (bottle/empty/cash) still awaiting a
  // charge-to-driver/company-loss/waived decision — see sheet-discrepancy-case
  // module. The reconcile dialog itself is only reachable pre-close, so this
  // is the only persistent place a closed sheet's open discrepancies surface.
  // Hook must run unconditionally on every render (Rules of Hooks) — sheetId
  // is a prop, always defined, so it doesn't need to wait on `data`/`isLoading`.
  const { data: openDiscrepancyCases } = useDiscrepancyCases({ dailySheetId: sheetId, status: 'REPORTED' });

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
  const openDiscrepancyCount = openDiscrepancyCases?.data?.length ?? 0;
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
  const tabCount = (tab: TabKey) =>
    tab === 'moved_out' ? searchFilteredMovedOutItems.length : tripFilteredItems.filter((i) => tabFilter(tab, i)).length;

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

  const handleSelectAll = (itemIds: string[]) => setSelectedIds(new Set(itemIds));

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
        canExport={canExport}
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

      {canRecordVehicleCheck && data.crewConfirmed && !startCheck && !isClosed && (
        <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 flex items-center gap-3 flex-wrap">
          <Gauge className="h-5 w-5 text-amber-500 flex-shrink-0" />
          <div className="flex-1 min-w-[200px]">
            <p className="text-sm font-bold text-amber-700 dark:text-amber-400">Vehicle Check Not Recorded</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Today&apos;s start-of-day vehicle check must be recorded before a trip can start.
            </p>
          </div>
          <Button
            size="sm"
            className="rounded-full font-bold"
            onClick={() => dispatch({ type: 'OPEN_VEHICLE_CHECK', checkType: 'START' })}
          >
            Record Check
          </Button>
        </div>
      )}

      {unresolvedCriticalCheck && !isClosed && (
        <div className="rounded-2xl border border-destructive/50 bg-destructive/10 px-4 py-3 flex items-center gap-3 flex-wrap">
          <ShieldAlert className="h-5 w-5 text-destructive flex-shrink-0" />
          <div className="flex-1 min-w-[200px]">
            <p className="text-sm font-bold text-destructive">Critical Vehicle Issue Reported</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {unresolvedCriticalCheck.checklistResults
                .filter((r) => r.isCritical && !r.passed)
                .map((r) => r.label)
                .join(', ')}{' '}
              — trip start is blocked until this is acknowledged.
            </p>
          </div>
          {canOverrideCriticalCheck && (
            <Button
              size="sm"
              variant="destructive"
              className="rounded-full font-bold"
              onClick={() => dispatch({ type: 'OPEN_CRITICAL_OVERRIDE' })}
            >
              Acknowledge
            </Button>
          )}
        </div>
      )}

      {/* Soft Close (Amendment R9): sheet closed by Driver/Salesman, awaiting Staff/Admin decision. */}
      {data.closureStatus === 'PENDING_APPROVAL' && (
        canApproveClose ? (
          <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 flex items-center gap-3 flex-wrap">
            <ClipboardList className="h-5 w-5 text-amber-500 flex-shrink-0" />
            <div className="flex-1 min-w-[200px]">
              <p className="text-sm font-bold text-amber-700 dark:text-amber-400">Sheet Closed — Pending Your Approval</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Closed by <span className="font-bold">{data.closureRequestedBy?.name ?? 'the driver'}</span>. Review and approve to finalize, or reject to send it back for correction.
              </p>
            </div>
            <div className="flex gap-2">
              {canRejectClose && (
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-full font-bold border-destructive/40 text-destructive hover:bg-destructive/10"
                  onClick={() => dispatch({ type: 'OPEN_REJECT_CLOSE' })}
                >
                  Reject
                </Button>
              )}
              <Button
                size="sm"
                className="rounded-full font-bold"
                onClick={() => dispatch({ type: 'OPEN_RECONCILE' })}
              >
                Review &amp; Approve
              </Button>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 flex items-center gap-3 flex-wrap">
            <ClipboardList className="h-5 w-5 text-amber-500 flex-shrink-0" />
            <div className="flex-1 min-w-[200px]">
              <p className="text-sm font-bold text-amber-700 dark:text-amber-400">Closed — Pending Staff Approval</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {data.closureRequestedBy?.id === user?.id ? 'Your close request is' : "This sheet's close request is"} waiting for Staff/Admin to review.
              </p>
            </div>
          </div>
        )
      )}

      {/* Reopened after a rejected close request — stays visible until the next close attempt. */}
      {data.closureStatus === 'REJECTED' && !isClosed && (
        <div className="rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3 flex items-start gap-3">
          <XCircle className="h-5 w-5 text-destructive mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-bold text-destructive">
              Close Request Rejected{data.closureRejectedBy?.name ? ` by ${data.closureRejectedBy.name}` : ''}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">{data.closureRejectionReason}</p>
          </div>
        </div>
      )}

      {/* Customer Move/Transfer footprint (source side) — items that left this
          sheet via moveDeliveryItems() are gone from `items` entirely (their
          dailySheetId now points elsewhere), so without this the sheet would
          silently show fewer customers with zero explanation. */}
      {(data.movedOutLogs?.length ?? 0) > 0 && (
        <div className="rounded-2xl border border-purple-500/30 bg-purple-500/5 overflow-hidden">
          <button
            type="button"
            onClick={() => setMovedOutExpanded((v) => !v)}
            className="w-full px-4 py-3 flex items-center gap-3 flex-wrap text-left"
          >
            <ArrowRightLeft className="h-5 w-5 text-purple-500 flex-shrink-0" />
            <div className="flex-1 min-w-[200px]">
              <p className="text-sm font-bold text-purple-700 dark:text-purple-400">
                {data.movedOutLogs.length} Customer{data.movedOutLogs.length > 1 ? 's' : ''} Moved Out
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Transferred to another van/sheet — no longer counted on this sheet.
              </p>
            </div>
            {movedOutExpanded ? <ChevronUp className="h-4 w-4 text-purple-500" /> : <ChevronDown className="h-4 w-4 text-purple-500" />}
          </button>
          <AnimatePresence>
            {movedOutExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="px-4 pb-4 space-y-2">
                  {data.movedOutLogs.map((log) => (
                    <div
                      key={log.id}
                      className="flex items-center justify-between gap-2 rounded-xl bg-background/70 border border-border/40 px-3 py-2 text-xs"
                    >
                      <div className="min-w-0">
                        <span className="font-bold">{log.customer.name}</span>
                        <span className="text-muted-foreground"> ({log.customer.customerCode})</span>
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          → Van {log.otherSheet.van?.plateNumber ?? '—'} ·{' '}
                          {new Date(log.otherSheet.date).toLocaleDateString('en-PK', { day: 'numeric', month: 'short' })}
                          {' · by '}{log.movedBy.name}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="rounded-full text-xs h-7 shrink-0"
                        onClick={() => router.push(`/dashboard/daily-sheets/${log.otherSheet.id}`)}
                      >
                        Go to Sheet
                      </Button>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {isClosed && openDiscrepancyCount > 0 && (
        <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 flex items-center gap-3 flex-wrap">
          <AlertOctagon className="h-5 w-5 text-amber-500 flex-shrink-0" />
          <div className="flex-1 min-w-[200px]">
            <p className="text-sm font-bold text-amber-700 dark:text-amber-400">
              {openDiscrepancyCount} Discrepancy Case{openDiscrepancyCount > 1 ? 's' : ''} Open
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Bottle/empty/cash reconciliation gap{openDiscrepancyCount > 1 ? 's' : ''} from close still need{openDiscrepancyCount > 1 ? '' : 's'} a resolution decision.
            </p>
          </div>
          <Button
            size="sm"
            className="rounded-full font-bold"
            onClick={() => router.push(
              openDiscrepancyCount === 1
                ? `/dashboard/discrepancy-cases/${openDiscrepancyCases!.data[0].id}`
                : `/dashboard/discrepancy-cases?dailySheetId=${sheetId}&status=REPORTED`,
            )}
          >
            Review
          </Button>
        </div>
      )}

      {canRecordVehicleCheck && startCheck && !endCheck && hasAnyTrip && !isClosed && (
        <div className="rounded-2xl border border-blue-500/40 bg-blue-500/10 px-4 py-3 flex items-center gap-3 flex-wrap">
          <Gauge className="h-5 w-5 text-blue-500 flex-shrink-0" />
          <div className="flex-1 min-w-[200px]">
            <p className="text-sm font-bold text-blue-600 dark:text-blue-400">End-of-Day Vehicle Check</p>
            <p className="text-xs text-muted-foreground mt-0.5">Record ending odometer and condition before wrapping up.</p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="rounded-full font-bold"
            onClick={() => dispatch({ type: 'OPEN_VEHICLE_CHECK', checkType: 'END' })}
          >
            Record
          </Button>
        </div>
      )}

      {/* Odometer Correction (2026-08-23): a compact readout of both recorded
          readings with a Staff/Admin-only fix, replacing the old permanent
          lock (once submitted, it used to never be editable again). */}
      {(startCheck || endCheck) && (
        <div className="rounded-2xl border border-border/50 bg-card/50 backdrop-blur-sm px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-2">
          <div className="flex items-center gap-1.5 text-xs font-bold uppercase text-muted-foreground">
            <Gauge className="h-4 w-4" />
            Odometer
          </div>
          {startCheck && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Start:</span>
              <span className="text-sm font-black">{startCheck.odometerReading.toLocaleString()} km</span>
              {startCheck.originalOdometerReading != null && (
                <span className="text-[10px] text-muted-foreground">(corrected)</span>
              )}
              {canEditVehicleCheck && (
                <button
                  type="button"
                  onClick={() => dispatch({ type: 'OPEN_EDIT_VEHICLE_CHECK', check: startCheck })}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  title="Correct start odometer"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}
          {endCheck && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">End:</span>
              <span className="text-sm font-black">{endCheck.odometerReading.toLocaleString()} km</span>
              {endCheck.originalOdometerReading != null && (
                <span className="text-[10px] text-muted-foreground">(corrected)</span>
              )}
              {canEditVehicleCheck && (
                <button
                  type="button"
                  onClick={() => dispatch({ type: 'OPEN_EDIT_VEHICLE_CHECK', check: endCheck })}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  title="Correct end odometer"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
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
            <div className={cn(
              'h-10 w-10 rounded-xl flex items-center justify-center shrink-0',
              kmTraveledIsAnomaly ? 'bg-destructive/10 text-destructive' : 'bg-teal-500/10 text-teal-500',
            )}>
              <Route className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase text-muted-foreground">Km Traveled Today</p>
              {kmTraveledToday === null ? (
                <p className="text-sm font-black truncate text-muted-foreground">
                  {startCheck ? 'In Progress' : '—'}
                </p>
              ) : kmTraveledIsAnomaly ? (
                <p className="text-sm font-black truncate text-destructive" title="End odometer reading is lower than the start reading — check the entries.">
                  ⚠ Check entry
                </p>
              ) : (
                <p className="text-sm font-black truncate">{kmTraveledToday.toLocaleString()} <span className="text-xs font-normal text-muted-foreground">km</span></p>
              )}
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
        {/* Filled Received is rare (account closing / excess stock returns) —
            hidden entirely rather than showing an empty "0 bottles" card. */}
        {stats.filledReceived > 0 && (
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
        )}
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
              <p className="text-[10px] font-bold uppercase text-muted-foreground" title="All recorded expenses (fuel included) plus cash handed to crew — the full cash-out figure for this sheet">Trip Expenses</p>
              <p className="text-sm font-black text-destructive truncate">
                ₨ {(
                  (data?.expenses ?? []).reduce((s, e) => s + e.amount, 0) +
                  (data?.crewCashDistributions ?? []).reduce((s, c) => s + c.amount, 0)
                ).toLocaleString()}
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
        tripStats={tripStats}
        canRequestClose={canRequestClose}
        onNewTrip={() => {
          // Backend also enforces this — trips cannot start with an unconfirmed crew
          if (!data.crewConfirmed) {
            toast.warning('Confirm today’s crew before starting a trip');
            dispatch({ type: 'OPEN_CREW_CONFIRM' });
            return;
          }
          // Backend also enforces this — a start-of-day vehicle check is required
          // before a trip can start (Fleet Phase 1, plan doc §7.2 "Mandatory").
          if (canRecordVehicleCheck && !startCheck) {
            toast.warning('Record the start-of-day vehicle check before starting a trip');
            dispatch({ type: 'OPEN_VEHICLE_CHECK', checkType: 'START' });
            return;
          }
          // Backend also enforces this — a critical vehicle-check failure blocks
          // trip start until Staff/Admin acknowledges it (Fleet Phase 1).
          if (unresolvedCriticalCheck) {
            toast.warning('A critical vehicle issue must be acknowledged before the trip can start');
            if (canOverrideCriticalCheck) dispatch({ type: 'OPEN_CRITICAL_OVERRIDE' });
            return;
          }
          dispatch({ type: 'OPEN_NEW_TRIP' });
        }}
        onReconcile={() => {
          // Backend also enforces this — an end-of-day vehicle check is required
          // before the sheet can be closed (Soft Close, Amendment R9, mirrors the
          // start-of-day gate on trip start).
          if (canRecordVehicleCheck && !endCheck) {
            toast.warning('Record the end-of-day vehicle check before closing the sheet');
            dispatch({ type: 'OPEN_VEHICLE_CHECK', checkType: 'END' });
            return;
          }
          dispatch({ type: 'OPEN_RECONCILE' });
        }}
        onRequestClose={() => {
          if (canRecordVehicleCheck && !endCheck) {
            toast.warning('Record the end-of-day vehicle check before closing the sheet');
            dispatch({ type: 'OPEN_VEHICLE_CHECK', checkType: 'END' });
            return;
          }
          dispatch({ type: 'OPEN_RECONCILE' });
        }}
        onCheckin={(tripId) => dispatch({ type: 'OPEN_CHECKIN', tripId })}
        isDriver={isDriver}
        canManageEditLocks={canManageEditLocks}
        onEditTrip={(loadId) => dispatch({ type: 'OPEN_EDIT_TRIP', tripId: loadId })}
        onRequestEditTrip={(loadId) => requestTripEdit.mutate(loadId)}
        requestingTripId={requestTripEdit.isPending ? ((requestTripEdit.variables as any) ?? null) : null}
        onUnlockEditTrip={(loadId) => unlockTripEdit.mutate({ loadId })}
        unlockingTripId={unlockTripEdit.isPending ? ((unlockTripEdit.variables as any)?.loadId ?? null) : null}
      />

      <SheetCashOutSection
        sheetId={sheetId}
        date={data!.date}
        expenses={data?.expenses ?? []}
        crewMembers={crewCashEmployees}
        isClosed={isClosed}
        canDeleteExpense={canDeleteExpense}
        canUpdateExpense={canUpdateExpense}
        currentUserId={user?.id}
        canEditAllCrewCash={canEditAllCrewCash}
        canDeleteAllCrewCash={canDeleteAllCrewCash}
      />

      {/* Ad-hoc / Correction Entry Actions */}
      {(
        (canBulkImport && !isClosed) ||
        (canRecordFuel && !isClosed) ||
        (canCreateExpense && !isClosed) ||
        (canCreateCrewCash && !isClosed) ||
        ((!isClosed && canUpdateSheet) || (isClosed && canCorrect)) ||
        canReportDamage
      ) && (
        <div className="flex justify-end gap-2">
          {canBulkImport && !isClosed && (
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
          <AddRecordMenu
            canLogFuel={canRecordFuel && !isClosed}
            canAddExpense={canCreateExpense && !isClosed}
            canAddCrewCash={canCreateCrewCash && !isClosed}
            canAddDelivery={(!isClosed && canUpdateSheet) || (isClosed && canCorrect)}
            isClosed={isClosed}
            canReportDamage={canReportDamage}
            onLogFuel={() => dispatch({ type: 'OPEN_FUEL_LOG' })}
            onAddExpense={() => dispatch({ type: 'OPEN_EXPENSE' })}
            onAddCrewCash={() => dispatch({ type: 'OPEN_CREW_CASH' })}
            onAddDelivery={() => dispatch({ type: isClosed ? 'OPEN_CORRECTION' : 'OPEN_ADHOC' })}
            onReportDamage={() => dispatch({ type: 'OPEN_DAMAGE' })}
          />
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
        loads={loads}
        tripFilter={ui.tripFilter}
        onTripFilterChange={(tripId) => dispatch({ type: 'SET_TRIP_FILTER', tripId })}
        movedInByItemId={movedInByItemId}
        isMovedOutView={ui.activeTab === 'moved_out'}
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
        canMove={canMoveCustomer}
        canVoidDelivery={canVoidDelivery}
        onVoidItem={(item) => setVoidTargetItem(item)}
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
        onSelectAll={handleSelectAll}
        onMoveItem={(itemId) => setMoveTargetIds([itemId])}
        onMoveSelected={() => setMoveTargetIds(Array.from(selectedIds))}
      />

      <ReconcileDialog
        open={ui.reconcileOpen}
        onClose={() => dispatch({ type: 'CLOSE_RECONCILE' })}
        sheetId={sheetId}
        mode={data.closureStatus === 'PENDING_APPROVAL' && canApproveClose ? 'approve' : canCloseSheet ? 'direct' : 'request'}
      />
      <RejectCloseDialog
        open={ui.rejectCloseOpen}
        onClose={() => dispatch({ type: 'CLOSE_REJECT_CLOSE' })}
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
        suggestedValues={{ returnedFilled: suggestedReturned, collectedEmpty: suggestedEmpty }}
      />
      {/* Trip Edit-Unlock — separate instance so an in-progress fresh check-in
          and a re-edit of an already-checked-in trip never share dialog state. */}
      <CheckinDialog
        open={ui.editTripOpen}
        onClose={() => dispatch({ type: 'CLOSE_EDIT_TRIP' })}
        sheetId={sheetId}
        mode="edit"
        trip={loads.find((l: any) => l.id === ui.editTripOpen) ?? undefined}
        editValues={(() => {
          const editingLoad = loads.find((l: any) => l.id === ui.editTripOpen);
          return editingLoad ? {
            returnedFilled: editingLoad.returnedFilled,
            collectedEmpty: editingLoad.collectedEmpty,
            damagedOnVan: editingLoad.damagedOnVan,
            leakedOnVan: editingLoad.leakedOnVan,
          } : undefined;
        })()}
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
      <VoidDeliveryDialog
        open={!!voidTargetItem}
        onClose={() => setVoidTargetItem(null)}
        sheetId={sheetId}
        item={voidTargetItem}
        isClosed={isClosed}
      />
      <BulkImportDialog
        open={ui.bulkImportOpen}
        onClose={() => dispatch({ type: 'CLOSE_BULK_IMPORT' })}
        sheetId={sheetId}
      />
      {ui.vehicleCheckOpen && (
        <VehicleCheckDialog
          open={!!ui.vehicleCheckOpen}
          onClose={() => dispatch({ type: 'CLOSE_VEHICLE_CHECK' })}
          sheetId={sheetId}
          checkType={ui.vehicleCheckOpen}
          vanId={data?.vanId ?? undefined}
        />
      )}
      <VehicleCheckEditDialog
        open={!!ui.editVehicleCheckOpen}
        onClose={() => dispatch({ type: 'CLOSE_EDIT_VEHICLE_CHECK' })}
        dailySheetId={sheetId}
        check={ui.editVehicleCheckOpen}
      />
      {unresolvedCriticalCheck && (
        <CriticalOverrideDialog
          open={ui.criticalOverrideOpen}
          onClose={() => dispatch({ type: 'CLOSE_CRITICAL_OVERRIDE' })}
          checkId={unresolvedCriticalCheck.id}
          dailySheetId={sheetId}
          failedItems={unresolvedCriticalCheck.checklistResults.filter((r) => r.isCritical && !r.passed).map((r) => r.label)}
        />
      )}
      {data?.vanId && (
        <FuelLogFormDialog
          vanId={data.vanId}
          dailySheetId={sheetId}
          open={ui.fuelLogOpen}
          onOpenChange={(o) => dispatch({ type: o ? 'OPEN_FUEL_LOG' : 'CLOSE_FUEL_LOG' })}
        />
      )}
      <ExpenseForm
        open={ui.expenseOpen}
        onOpenChange={(o) => dispatch({ type: o ? 'OPEN_EXPENSE' : 'CLOSE_EXPENSE' })}
        dailySheetId={sheetId}
        defaultVanId={data?.vanId ?? undefined}
      />
      <CrewCashForm
        open={ui.crewCashOpen}
        onOpenChange={(o) => dispatch({ type: o ? 'OPEN_CREW_CASH' : 'CLOSE_CREW_CASH' })}
        sheetId={sheetId}
        employees={crewCashEmployees}
        entry={null}
      />
      <ReportDamageDialog
        open={ui.damageOpen}
        onClose={() => dispatch({ type: 'CLOSE_DAMAGE' })}
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
