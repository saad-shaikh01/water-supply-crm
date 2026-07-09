'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, Button, Badge, Tabs, TabsList, TabsTrigger, Skeleton, Dialog, DialogContent, DialogHeader, DialogTitle } from '@water-supply-crm/ui';
import { StatusBadge } from '../../../components/shared/status-badge';
import {
  AlertCircle, Camera, Check, CheckSquare, ChevronDown, ChevronUp, ClipboardList, Download,
  History, LocateFixed, Lock, Loader2, MapPin, MessageCircle, MessageSquare, Navigation, Phone, Send, StickyNote, Truck, Unlock, X,
} from 'lucide-react';
import { cn } from '@water-supply-crm/ui';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import type { DeliveryItem } from '@water-supply-crm/types';
import { useCustomerDeliveryHistory, useDeliveryPhotoUrl } from '../hooks/use-daily-sheets';
import { dailySheetsApi } from '../api/daily-sheets.api';
import { reverseGeocode } from '../../../lib/geocoding';
import { DeliveryRecordForm } from './delivery-record-form';
import { AddNoteDialog } from './add-note-dialog';
import { ItemNotesPanel, DriverNoteGate } from './item-notes-panel';

type TabKey = 'all' | 'pending' | 'completed' | 'issues';

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

/** Statuses eligible to move to a different van/sheet — mirrors the backend's MOVE_ELIGIBLE_STATUSES. */
const MOVE_ELIGIBLE_STATUSES = ['PENDING', 'NOT_AVAILABLE', 'RESCHEDULED'];

const formatPhone = (phone?: string | null) => {
  if (!phone) return '';
  return phone.startsWith('0') ? `92${phone.slice(1)}` : phone;
};

function CustomerHistorySection({ customerId }: { customerId: string }) {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useCustomerDeliveryHistory(customerId, open);

  return (
    <div className="border-t border-border/40 pt-3 mt-1">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground hover:text-foreground transition-colors w-full text-left"
      >
        <History className="h-3.5 w-3.5" />
        Last 6 Deliveries
        {open ? (
          <ChevronUp className="h-3.5 w-3.5 ml-auto" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 ml-auto" />
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden w-full"
          >
            <div className="mt-2 overflow-x-auto rounded-xl border border-border/40">
              {isLoading ? (
                <div className="p-3 space-y-2">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-7 w-full rounded-lg" />
                  ))}
                </div>
              ) : !data || data.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">
                  No previous deliveries found
                </p>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border/40 bg-muted/30">
                      <th className="text-left px-3 py-2 font-bold text-muted-foreground whitespace-nowrap">Date</th>
                      <th className="text-center px-2 py-2 font-bold text-muted-foreground">↓ Fill</th>
                      <th className="text-center px-2 py-2 font-bold text-muted-foreground">↑ Emp</th>
                      <th className="text-center px-2 py-2 font-bold text-muted-foreground whitespace-nowrap">Btl Bal</th>
                      <th className="text-right px-2 py-2 font-bold text-muted-foreground whitespace-nowrap">Amt Due</th>
                      <th className="text-right px-2 py-2 font-bold text-muted-foreground whitespace-nowrap">Received</th>
                      <th className="text-right px-3 py-2 font-bold text-muted-foreground whitespace-nowrap">Bal Due</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.map((row, i) => {
                      const amountDue = row.filledDropped * row.pricePerBottle;
                      const balDue = row.financialBalanceAfter;
                      const dateStr = row.deliveredAt
                        ? new Date(row.deliveredAt).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: '2-digit' })
                        : new Date(row.dailySheet.date).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: '2-digit' });
                      return (
                        <tr key={row.id} className={cn('border-b border-border/30 last:border-0', i % 2 === 0 ? '' : 'bg-muted/10')}>
                          <td className="px-3 py-2 whitespace-nowrap font-medium">{dateStr}</td>
                          <td className="px-2 py-2 text-center font-bold text-orange-600">{row.filledDropped}</td>
                          <td className="px-2 py-2 text-center font-bold text-purple-600">{row.emptyReceived}</td>
                          <td className="px-2 py-2 text-center font-bold">
                            {row.bottleBalanceAfter != null ? row.bottleBalanceAfter : '—'}
                          </td>
                          <td className="px-2 py-2 text-right">₨{amountDue.toLocaleString()}</td>
                          <td className="px-2 py-2 text-right text-emerald-600 font-medium">₨{row.cashCollected.toLocaleString()}</td>
                          <td className={cn('px-3 py-2 text-right font-bold', balDue == null ? '' : balDue > 0 ? 'text-destructive' : 'text-emerald-600')}>
                            {balDue != null ? `₨${balDue.toLocaleString()}` : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface DeliveryItemsListProps {
  sheetId: string;
  items: DeliveryItem[];
  paginatedItems: DeliveryItem[];
  filteredItems: DeliveryItem[];
  activeTab: TabKey;
  tabPage: number;
  totalPages: number;
  expandedItemId: string | null;
  isClosed: boolean;
  tabCount: (tab: TabKey) => number;
  onTabChange: (tab: string) => void;
  onPageChange: (page: number) => void;
  onToggleExpand: (itemId: string | null) => void;
  onSaveLocation: (customerId: string, lat: number, lng: number, address?: string) => Promise<void>;
  isDriver: boolean;
  isAdminOrStaff: boolean;
  onUnlockEdit: (itemId: string) => void;
  unlockingItemId: string | null;
  onRequestEdit: (itemId: string) => void;
  requestingItemId: string | null;
  selectMode: boolean;
  onToggleSelectMode: () => void;
  selectedIds: Set<string>;
  onToggleSelected: (itemId: string) => void;
  onMoveItem: (itemId: string) => void;
  onMoveSelected: () => void;
}

export function DeliveryItemsList({
  sheetId,
  items,
  paginatedItems,
  filteredItems,
  activeTab,
  tabPage,
  totalPages,
  expandedItemId,
  isClosed,
  tabCount,
  onTabChange,
  onPageChange,
  onToggleExpand,
  onSaveLocation,
  isDriver,
  isAdminOrStaff,
  onUnlockEdit,
  unlockingItemId,
  onRequestEdit,
  requestingItemId,
  selectMode,
  onToggleSelectMode,
  selectedIds,
  onToggleSelected,
  onMoveItem,
  onMoveSelected,
}: DeliveryItemsListProps) {
  const [savingLocationItemId, setSavingLocationItemId] = useState<string | null>(null);
  const [addNoteItem, setAddNoteItem] = useState<DeliveryItem | null>(null);
  const [viewPhotoItemId, setViewPhotoItemId] = useState<string | null>(null);
  const [downloadingReceiptId, setDownloadingReceiptId] = useState<string | null>(null);

  const handleDownloadReceipt = async (item: DeliveryItem) => {
    setDownloadingReceiptId(item.id);
    try {
      const res = await dailySheetsApi.downloadReceipt(item.id);
      const blob = res.data as Blob;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `receipt-${item.customer?.customerCode ?? item.id}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Receipt not available for this delivery');
    } finally {
      setDownloadingReceiptId(null);
    }
  };

  const handleGpsCapture = (item: DeliveryItem) => {
    if (!navigator.geolocation) {
      toast.error('Geolocation is not supported by your browser');
      return;
    }
    setSavingLocationItemId(item.id);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const address = await reverseGeocode(pos.coords.latitude, pos.coords.longitude);
          await onSaveLocation(item.customerId, pos.coords.latitude, pos.coords.longitude, address || undefined);
          toast.success('Location saved');
        } catch {
          // error toast handled by mutation
        } finally {
          setSavingLocationItemId(null);
        }
      },
      (err) => {
        setSavingLocationItemId(null);
        if (err.code === GeolocationPositionError.PERMISSION_DENIED) {
          toast.error('Location access denied. Please allow location in your browser settings.');
        } else {
          toast.error('Could not get your current location');
        }
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const eligibleForMoveCount = items.filter((i) => MOVE_ELIGIBLE_STATUSES.includes(i.status)).length;
  const canBulkMove = isAdminOrStaff && !isClosed && eligibleForMoveCount > 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-black flex items-center gap-2">
          <ClipboardList className="h-5 w-5 text-primary" />
          Delivery Queue
        </h3>
        <div className="flex items-center gap-3">
          <p className="text-xs text-muted-foreground font-medium">
            {items.filter((i) => i.status !== 'PENDING').length} / {items.length} done
          </p>
          {canBulkMove && (
            <Button
              size="sm"
              variant={selectMode ? 'default' : 'outline'}
              className="rounded-full font-bold text-xs h-8 gap-1.5"
              onClick={onToggleSelectMode}
            >
              <CheckSquare className="h-3.5 w-3.5" />
              {selectMode ? 'Cancel Select' : 'Select'}
            </Button>
          )}
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={onTabChange}>
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
            const hasActiveEditUnlock =
              !!item.editUnlockExpiresAt && new Date(item.editUnlockExpiresAt) > new Date();

            const notes = item.notes ?? [];
            const pendingNotesCount = notes.filter((n) => !n.acknowledgedAt).length;
            const allNotesAcknowledged = notes.length === 0 || pendingNotesCount === 0;

            // Whether the inline record/edit form may be shown for this item.
            const canRecord =
              !isClosed &&
              allNotesAcknowledged &&
              (item.status === 'PENDING' || !isDriver || hasActiveEditUnlock);

            // Driver sees the gate when there are unacknowledged notes
            const showDriverGate =
              isDriver &&
              !isClosed &&
              notes.length > 0 &&
              !allNotesAcknowledged;

            const isEligibleForMove = MOVE_ELIGIBLE_STATUSES.includes(item.status);
            const isSelected = selectedIds.has(item.id);

            return (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.03 }}
                className="min-w-0 w-full"
              >
                <Card className={cn(
                  'overflow-hidden border-border/50 transition-all',
                  item.status !== 'PENDING' ? 'bg-muted/30' : 'bg-card/50',
                  isExpanded ? 'border-primary/30 shadow-sm' : 'hover:border-primary/20',
                  selectMode && !isEligibleForMove && 'opacity-40',
                  selectMode && isEligibleForMove && isSelected && 'border-primary/50 ring-1 ring-primary/40',
                )}>
                  <CardContent
                    className={cn('p-4 sm:p-5', (!selectMode || isEligibleForMove) && 'cursor-pointer')}
                    onClick={() => {
                      if (selectMode) {
                        if (isEligibleForMove) onToggleSelected(item.id);
                        return;
                      }
                      onToggleExpand(isExpanded ? null : item.id);
                    }}
                  >
                    <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <div className={cn(
                          'h-9 w-9 rounded-full flex items-center justify-center shrink-0 font-black text-sm transition-colors',
                          selectMode && isEligibleForMove && isSelected
                            ? 'bg-primary text-primary-foreground'
                            : selectMode && isEligibleForMove
                              ? 'bg-accent ring-2 ring-primary/30'
                              : 'bg-accent',
                        )}>
                          {selectMode && isEligibleForMove && isSelected ? <Check className="h-4 w-4" /> : item.sequence}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Link
                              href={`/dashboard/customers/${item.customerId}`}
                              onClick={(e) => e.stopPropagation()}
                              className="font-bold text-sm truncate hover:underline hover:text-primary transition-colors"
                            >
                              {customer?.name}
                            </Link>
                            <Badge variant="outline" className="text-[9px] font-mono px-1.5">{customer?.customerCode}</Badge>
                            {customer?.paymentType && (
                              <Badge
                                variant={customer.paymentType === 'MONTHLY' ? 'info' : 'success'}
                                className="text-[9px] px-1.5"
                              >
                                {customer.paymentType === 'MONTHLY' ? 'Monthly' : 'Cash'}
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground truncate flex items-center gap-1 mt-0.5">
                            <MapPin className="h-2.5 w-2.5 shrink-0" />
                            {customer?.address}
                            {customer?.floor ? ` · ${customer.floor}` : ''}
                          </p>
                          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                            {(() => {
                              const isMonthly = customer?.paymentType === 'MONTHLY';
                              const financialValue = isMonthly
                                ? (customer?.previousMonthOutstanding ?? 0)
                                : (customer?.financialBalance ?? 0);
                              return (
                                <span className={cn(
                                  'text-sm font-black px-2.5 py-1 rounded-lg leading-none border',
                                  financialValue > 0
                                    ? 'bg-destructive/15 text-destructive border-destructive/30'
                                    : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30',
                                )}>
                                  {isMonthly ? 'Outstanding ' : 'Due '}₨{financialValue.toLocaleString()}
                                </span>
                              );
                            })()}
                            {customer?.consumptionRate30d != null && (
                              <span className={cn(
                                'text-[9px] font-bold',
                                customer.consumptionRate30d >= 80
                                  ? 'text-emerald-600 dark:text-emerald-400'
                                  : 'text-destructive',
                              )}>
                                {customer.consumptionRate30d}%
                              </span>
                            )}
                            {item.status !== 'PENDING' && item.filledDropped > 0 && (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full leading-none bg-orange-500/15 text-orange-700 dark:text-orange-400">
                                ↓{item.filledDropped}
                              </span>
                            )}
                            {item.status !== 'PENDING' && item.emptyReceived > 0 && (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full leading-none bg-purple-500/15 text-purple-700 dark:text-purple-400">
                                ↑{item.emptyReceived}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className={cn('flex items-center gap-2 flex-wrap w-full sm:w-auto sm:shrink-0', selectMode && 'hidden')}>
                        {notes.length > 0 && (
                          <div className={cn(
                            'flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full',
                            pendingNotesCount > 0
                              ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400'
                              : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
                          )}>
                            <StickyNote className="h-2.5 w-2.5" />
                            {pendingNotesCount > 0 ? `${pendingNotesCount} Note${pendingNotesCount > 1 ? 's' : ''} ⚠` : `${notes.length} Note${notes.length > 1 ? 's' : ''} ✓`}
                          </div>
                        )}
                        <StatusBadge status={item.status} />
                        {item.isCorrection && (
                          <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
                            CORRECTION
                          </span>
                        )}
                        {!item.isCorrection && item.deliveryType === 'ON_DEMAND' && !item.sourceOrderId && (
                          <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
                            AD-HOC
                          </span>
                        )}
                        {item.whatsappSentAt && (
                          <div
                            title={`WhatsApp sent at ${new Date(item.whatsappSentAt).toLocaleTimeString()}`}
                            className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                          >
                            <MessageSquare className="h-3 w-3" />
                            <span className="text-[9px] font-bold">WA</span>
                          </div>
                        )}
                        {!isClosed && item.status === 'PENDING' && (
                          <Button
                            size="sm"
                            variant="default"
                            className="rounded-full font-bold text-xs h-8 sm:h-10 px-3 sm:px-4 sm:min-w-[72px]"
                            onClick={(e) => { e.stopPropagation(); onToggleExpand(isExpanded ? null : item.id); }}
                          >
                            {isExpanded ? 'Close' : 'Record'}
                          </Button>
                        )}
                        {!isClosed && item.status !== 'PENDING' && (
                          <div className="flex items-center gap-1">
                            {isDriver ? (
                              hasActiveEditUnlock ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="rounded-full font-bold text-xs h-10 px-4 border-amber-500/50 text-amber-600 dark:text-amber-400"
                                  onClick={(e) => { e.stopPropagation(); onToggleExpand(isExpanded ? null : item.id); }}
                                >
                                  Edit
                                </Button>
                              ) : item.editRequestedAt ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="rounded-full font-bold text-xs h-10 px-4 opacity-60 cursor-not-allowed border-blue-500/40 text-blue-500"
                                  disabled
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <Send className="h-3 w-3 mr-1" />
                                  Requested
                                </Button>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="rounded-full font-bold text-xs h-10 px-4 border-amber-500/40 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10"
                                  disabled={requestingItemId === item.id}
                                  onClick={(e) => { e.stopPropagation(); onRequestEdit(item.id); }}
                                >
                                  {requestingItemId === item.id ? (
                                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                                  ) : (
                                    <Lock className="h-3 w-3 mr-1" />
                                  )}
                                  Request Edit
                                </Button>
                              )
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                className="rounded-full font-bold text-xs h-10 px-4"
                                onClick={(e) => { e.stopPropagation(); onToggleExpand(isExpanded ? null : item.id); }}
                              >
                                Edit
                              </Button>
                            )}
                            {isAdminOrStaff && (
                              <button
                                className={cn(
                                  'h-8 w-8 rounded-full flex items-center justify-center transition-colors relative',
                                  item.editRequestedAt && !hasActiveEditUnlock
                                    ? 'text-amber-600 bg-amber-500/15 hover:bg-amber-500/25'
                                    : 'text-muted-foreground hover:text-amber-600 hover:bg-amber-500/10',
                                )}
                                title={item.editRequestedAt && !hasActiveEditUnlock ? 'Driver requested edit — click to unlock' : 'Unlock edit for driver'}
                                disabled={unlockingItemId === item.id}
                                onClick={(e) => { e.stopPropagation(); onUnlockEdit(item.id); }}
                              >
                                {unlockingItemId === item.id ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <>
                                    <Unlock className="h-3.5 w-3.5" />
                                    {item.editRequestedAt && !hasActiveEditUnlock && (
                                      <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
                                    )}
                                  </>
                                )}
                              </button>
                            )}
                          </div>
                        )}
                        {isAdminOrStaff && !isClosed && isEligibleForMove && (
                          <button
                            className="h-8 w-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                            title="Move to another van/sheet"
                            onClick={(e) => { e.stopPropagation(); onMoveItem(item.id); }}
                          >
                            <Truck className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <button
                          className="h-8 w-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                          onClick={(e) => { e.stopPropagation(); onToggleExpand(isExpanded ? null : item.id); }}
                        >
                          {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>
                  </CardContent>

                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden w-full"
                      >
                        <div className="border-t border-border/50 bg-accent/10 p-4 sm:p-5 space-y-4">
                          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                            <div className="rounded-xl bg-background/70 border border-border/40 px-3 py-2">
                              <p className="text-[9px] font-bold uppercase text-muted-foreground">Bottle Wallet</p>
                              <p className="text-base font-black mt-0.5">{walletBalance} btl</p>
                            </div>
                            {(() => {
                              const isMonthly = customer?.paymentType === 'MONTHLY';
                              const financialLabel = isMonthly ? 'Prev. Month Outstanding' : 'Balance Due';
                              const financialValue = isMonthly
                                ? (customer?.previousMonthOutstanding ?? 0)
                                : (customer?.financialBalance ?? 0);
                              return (
                                <div className="rounded-xl bg-background/70 border border-border/40 px-3 py-2">
                                  <p className="text-[9px] font-bold uppercase text-muted-foreground">{financialLabel}</p>
                                  <p className={cn('text-base font-black mt-0.5', financialValue > 0 ? 'text-destructive' : 'text-emerald-600')}>
                                    ₨{financialValue.toLocaleString()}
                                  </p>
                                </div>
                              );
                            })()}
                            <div className="rounded-xl bg-background/70 border border-border/40 px-3 py-2">
                              <p className="text-[9px] font-bold uppercase text-muted-foreground">Payment</p>
                              <p className="text-base font-black mt-0.5">{customer?.paymentType ?? '—'}</p>
                            </div>
                            <div className="rounded-xl bg-background/70 border border-border/40 px-3 py-2">
                              <p className="text-[9px] font-bold uppercase text-muted-foreground">Phone</p>
                              <p className="text-sm font-black mt-0.5 truncate">{customer?.phoneNumber ?? '—'}</p>
                            </div>
                            {(() => {
                              const customEntry = customer?.customPrices?.find((cp) => cp.productId === item.productId);
                              const basePrice = item.product?.basePrice;
                              const rate = customEntry?.customPrice ?? basePrice;
                              const isCustom = !!customEntry;
                              return (
                                <div className={cn(
                                  'rounded-xl border px-3 py-2',
                                  isCustom
                                    ? 'bg-amber-500/10 border-amber-500/30'
                                    : 'bg-background/70 border-border/40'
                                )}>
                                  <p className={cn('text-[9px] font-bold uppercase', isCustom ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground')}>
                                    {isCustom ? 'Custom Rate' : 'Rate'}
                                  </p>
                                  <p className={cn('text-base font-black mt-0.5', isCustom && 'text-amber-600 dark:text-amber-400')}>
                                    {rate != null ? `₨${rate.toLocaleString()}` : '—'}
                                  </p>
                                </div>
                              );
                            })()}
                          </div>

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
                            {item.status === 'COMPLETED' && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="rounded-full font-bold gap-1.5 text-xs h-8 text-indigo-600 border-indigo-500/30 hover:bg-indigo-500/10"
                                disabled={downloadingReceiptId === item.id}
                                onClick={(e) => { e.stopPropagation(); handleDownloadReceipt(item); }}
                              >
                                {downloadingReceiptId === item.id ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Download className="h-3.5 w-3.5" />
                                )}
                                Receipt
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              className={cn(
                                'rounded-full font-bold gap-1.5 text-xs h-8',
                                customer?.latitude && customer?.longitude
                                  ? 'text-orange-600 border-orange-500/30 hover:bg-orange-500/10'
                                  : 'text-emerald-600 border-emerald-500/30 hover:bg-emerald-500/10',
                              )}
                              disabled={savingLocationItemId === item.id}
                              onClick={() => handleGpsCapture(item)}
                            >
                              <LocateFixed className="h-3.5 w-3.5" />
                              {savingLocationItemId === item.id
                                ? 'Saving…'
                                : customer?.latitude && customer?.longitude
                                  ? 'Change Location'
                                  : 'Add Location'}
                            </Button>
                          </div>

                          {item.failureCategory && (
                            <div className="flex items-start justify-between gap-2 text-xs bg-destructive/5 rounded-xl px-3 py-2 border border-destructive/20">
                              <div className="flex items-start gap-2">
                                <AlertCircle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
                                <div>
                                  <span className="font-bold text-destructive">{formatCategory(item.failureCategory)}</span>
                                  {item.reason && <span className="text-muted-foreground"> · {item.reason}</span>}
                                </div>
                              </div>
                              {item.photoKey && (
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); setViewPhotoItemId(item.id); }}
                                  className="flex items-center gap-1 shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full bg-destructive/15 text-destructive hover:bg-destructive/25 transition-colors"
                                >
                                  <Camera className="h-3.5 w-3.5" />
                                  View Photo
                                </button>
                              )}
                            </div>
                          )}
                          {!item.failureCategory && item.reason && (
                            <p className="text-xs text-muted-foreground bg-background/70 rounded-xl px-3 py-2 border border-border/40">
                              <span className="font-bold">Note:</span> {item.reason}
                            </p>
                          )}
                          {item.deliveredAt && (item.status === 'COMPLETED' || item.status === 'EMPTY_ONLY') && (
                            <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                              <span className="font-bold">Delivered at:</span>
                              {new Date(item.deliveredAt).toLocaleTimeString('en-US', {
                                hour: 'numeric',
                                minute: '2-digit',
                                hour12: true,
                              })}
                            </p>
                          )}
                          {item.editUnlockExpiresAt &&
                            new Date(item.editUnlockExpiresAt) > new Date() && (
                              <p className="text-[11px] font-bold text-amber-600 dark:text-amber-400 flex items-center gap-1">
                                <Unlock className="h-3 w-3" />
                                Edit unlocked · expires{' '}
                                {new Date(item.editUnlockExpiresAt).toLocaleTimeString('en-US', {
                                  hour: 'numeric',
                                  minute: '2-digit',
                                  hour12: true,
                                })}
                              </p>
                            )}
                          {/* Admin/Staff: notes panel + Add Note button */}
                          {isAdminOrStaff && !isClosed && (
                            <div className="flex justify-end">
                              <Button
                                size="sm"
                                variant="outline"
                                className="rounded-full font-bold gap-1.5 text-xs h-8"
                                onClick={() => setAddNoteItem(item)}
                              >
                                <StickyNote className="h-3.5 w-3.5" />
                                Add Note
                              </Button>
                            </div>
                          )}

                          {notes.length > 0 && (
                            <>
                              {/* Driver gate: must acknowledge before delivery form */}
                              {showDriverGate ? (
                                <DriverNoteGate
                                  notes={notes}
                                  sheetId={sheetId}
                                />
                              ) : (
                                <ItemNotesPanel
                                  notes={notes}
                                  sheetId={sheetId}
                                  isDriver={isDriver}
                                />
                              )}
                            </>
                          )}

                          {canRecord ? (
                            <DeliveryRecordForm
                              key={item.id}
                              item={item}
                              sheetId={sheetId}
                              onDone={() => onToggleExpand(null)}
                            />
                          ) : item.status !== 'PENDING' ? (
                            <DeliveryRecordForm
                              key={`${item.id}-ro`}
                              item={item}
                              sheetId={sheetId}
                              onDone={() => onToggleExpand(null)}
                              readOnly
                            />
                          ) : null}

                          <CustomerHistorySection customerId={item.customerId} />
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

      {totalPages > 1 && (
        <div className="flex items-center justify-between gap-2 pt-2">
          <Button
            size="sm"
            variant="outline"
            className="rounded-full font-bold"
            disabled={tabPage <= 1}
            onClick={() => onPageChange(Math.max(1, tabPage - 1))}
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
            onClick={() => onPageChange(Math.min(totalPages, tabPage + 1))}
          >
            Next
          </Button>
        </div>
      )}

      {selectMode && selectedIds.size > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 rounded-full border border-border/50 bg-background/95 backdrop-blur-xl shadow-2xl px-4 py-2.5">
          <span className="text-xs font-bold whitespace-nowrap">{selectedIds.size} selected</span>
          <Button
            size="sm"
            variant="ghost"
            className="rounded-full font-bold text-xs h-8 gap-1"
            onClick={onToggleSelectMode}
          >
            <X className="h-3.5 w-3.5" />
            Cancel
          </Button>
          <Button
            size="sm"
            className="rounded-full font-bold text-xs h-8 gap-1.5"
            onClick={onMoveSelected}
          >
            <Truck className="h-3.5 w-3.5" />
            Move Selected
          </Button>
        </div>
      )}

      {addNoteItem && (
        <AddNoteDialog
          open={!!addNoteItem}
          onClose={() => setAddNoteItem(null)}
          itemId={addNoteItem.id}
          sheetId={sheetId}
          customerName={addNoteItem.customer?.name ?? 'Customer'}
          sequence={addNoteItem.sequence}
        />
      )}

      {viewPhotoItemId && (
        <DeliveryPhotoViewDialog
          itemId={viewPhotoItemId}
          onClose={() => setViewPhotoItemId(null)}
        />
      )}
    </div>
  );
}

function DeliveryPhotoViewDialog({ itemId, onClose }: { itemId: string; onClose: () => void }) {
  const { data, isLoading } = useDeliveryPhotoUrl(itemId, !!itemId);

  return (
    <Dialog open={!!itemId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="rounded-3xl max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-lg font-black">Delivery Photo</DialogTitle>
        </DialogHeader>
        <div className="flex items-center justify-center min-h-[200px]">
          {isLoading ? (
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          ) : data?.signedUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={data.signedUrl}
              alt="Delivery failure evidence"
              className="max-h-[70vh] w-full object-contain rounded-xl"
            />
          ) : (
            <p className="text-sm text-muted-foreground">Photo not available</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
