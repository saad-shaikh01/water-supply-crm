'use client';

import { useState } from 'react';
import {
  Card, CardContent, CardHeader, CardTitle, Button, Skeleton, Badge,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Input, Label,
} from '@water-supply-crm/ui';
import { PageHeader } from '../../../components/shared/page-header';
import { StatusBadge } from '../../../components/shared/status-badge';
import { useDailySheet, useStartLoadOut, useCheckIn, useCloseSheet } from '../hooks/use-daily-sheets';
import { dailySheetsApi } from '../api/daily-sheets.api';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../../lib/query-keys';

interface DeliveryItem {
  id: string;
  customer?: { name: string };
  plannedBottles?: number;
  deliveredBottles?: number;
  notes?: string;
  status?: string;
  amount?: number;
}

interface SheetDetailProps {
  sheetId: string;
}

export function SheetDetail({ sheetId }: SheetDetailProps) {
  const { data, isLoading } = useDailySheet(sheetId);
  const { mutate: startLoadOut, isPending: isLoadingOut } = useStartLoadOut(sheetId);
  const { mutate: checkIn, isPending: isCheckingIn } = useCheckIn(sheetId);
  const { mutate: closeSheet, isPending: isClosing } = useCloseSheet(sheetId);
  const queryClient = useQueryClient();

  // Per-item delivery inputs: { [itemId]: { bottles: number; notes: string } }
  const [deliveryInputs, setDeliveryInputs] = useState<Record<string, { bottles: number; notes: string }>>({});
  const [savingItem, setSavingItem] = useState<string | null>(null);

  // Check-in dialog state
  const [checkInOpen, setCheckInOpen] = useState(false);
  const [emptiesReturned, setEmptiesReturned] = useState(0);

  if (isLoading) return <Skeleton className="h-96 w-full" />;

  const sheet = (data ?? {}) as Record<string, unknown>;
  const items = (sheet.items ?? []) as DeliveryItem[];
  const status = String(sheet.status ?? '');

  const getItemInput = (item: DeliveryItem) =>
    deliveryInputs[item.id] ?? {
      bottles: item.deliveredBottles ?? item.plannedBottles ?? 0,
      notes: item.notes ?? '',
    };

  const setItemBottles = (itemId: string, bottles: number, currentNotes: string) =>
    setDeliveryInputs((prev) => ({ ...prev, [itemId]: { bottles, notes: currentNotes } }));

  const setItemNotes = (itemId: string, notes: string, currentBottles: number) =>
    setDeliveryInputs((prev) => ({ ...prev, [itemId]: { bottles: currentBottles, notes } }));

  const handleSaveDelivery = async (item: DeliveryItem) => {
    const input = getItemInput(item);
    setSavingItem(item.id);
    try {
      await dailySheetsApi.updateDeliveryItem(sheetId, item.id, {
        deliveredBottles: input.bottles,
        notes: input.notes || undefined,
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.sheets.one(sheetId) });
      toast.success('Delivery updated');
    } catch {
      toast.error('Failed to update delivery');
    } finally {
      setSavingItem(null);
    }
  };

  const handleCheckIn = () => {
    checkIn({ emptiesReturned }, { onSuccess: () => setCheckInOpen(false) });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Sheet — ${new Date(String(sheet.date ?? '')).toLocaleDateString()}`}
        description={`Route: ${(sheet.route as { name?: string } | undefined)?.name ?? '—'}`}
        action={
          <div className="flex gap-2">
            {status === 'GENERATED' && (
              <Button onClick={() => startLoadOut({})} disabled={isLoadingOut}>
                {isLoadingOut ? 'Starting...' : 'Start Load-Out'}
              </Button>
            )}
            {status === 'LOADED' && (
              <Button onClick={() => dailySheetsApi.startDeliveries(sheetId).then(() => {
                queryClient.invalidateQueries({ queryKey: queryKeys.sheets.one(sheetId) });
                toast.success('Deliveries started');
              }).catch(() => toast.error('Failed'))}>
                Start Deliveries
              </Button>
            )}
            {status === 'DELIVERING' && (
              <Button onClick={() => setCheckInOpen(true)}>
                Check In
              </Button>
            )}
            {status === 'CHECKED_IN' && (
              <Button onClick={() => closeSheet()} disabled={isClosing}>
                {isClosing ? 'Closing...' : 'Close Sheet'}
              </Button>
            )}
          </div>
        }
      />

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Status</CardTitle></CardHeader>
          <CardContent><StatusBadge status={status} /></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Driver</CardTitle></CardHeader>
          <CardContent><p className="font-semibold">{(sheet.driver as { name?: string } | undefined)?.name ?? '—'}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Van</CardTitle></CardHeader>
          <CardContent><p className="font-semibold">{(sheet.van as { plateNumber?: string } | undefined)?.plateNumber ?? '—'}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Items</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold">{items.length}</p></CardContent>
        </Card>
      </div>

      {/* Delivery Items */}
      <Card>
        <CardHeader><CardTitle>Delivery Items</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-3">
            {items.map((item) => {
              const input = getItemInput(item);
              const isDelivering = status === 'DELIVERING';
              return (
                <div key={item.id} className="p-4 rounded-md border space-y-3">
                  {/* Top row: customer + amount badge */}
                  <div className="flex items-center justify-between">
                    <p className="font-medium">{item.customer?.name ?? 'Unknown'}</p>
                    <Badge variant="outline">${Number(item.amount ?? 0).toFixed(2)}</Badge>
                  </div>

                  {/* Bottles row */}
                  <div className="flex items-center gap-4">
                    <span className="text-sm text-muted-foreground w-28 shrink-0">
                      Planned: <strong>{item.plannedBottles ?? 0}</strong>
                    </span>
                    {isDelivering ? (
                      <div className="flex items-center gap-2 flex-1">
                        <Label className="text-sm shrink-0">Delivered:</Label>
                        <Input
                          type="number"
                          min={0}
                          max={item.plannedBottles ?? 999}
                          value={input.bottles}
                          onChange={(e) => setItemBottles(item.id, Number(e.target.value), input.notes)}
                          className="w-24 h-8 text-sm"
                        />
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground">
                        Delivered: <strong>{item.deliveredBottles ?? 0}</strong>
                      </span>
                    )}
                  </div>

                  {/* Notes row */}
                  {isDelivering && (
                    <div className="flex items-center gap-2">
                      <Label className="text-sm shrink-0 w-28">Note:</Label>
                      <Input
                        placeholder="e.g. customer absent, partial delivery..."
                        value={input.notes}
                        onChange={(e) => setItemNotes(item.id, e.target.value, input.bottles)}
                        className="h-8 text-sm"
                      />
                    </div>
                  )}

                  {/* Notes display (read-only when not delivering) */}
                  {!isDelivering && item.notes && (
                    <p className="text-sm text-muted-foreground italic">Note: {item.notes}</p>
                  )}

                  {/* Save button */}
                  {isDelivering && (
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        disabled={savingItem === item.id}
                        onClick={() => handleSaveDelivery(item)}
                      >
                        {savingItem === item.id ? 'Saving...' : 'Save'}
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
            {!items.length && (
              <p className="text-center text-muted-foreground py-8">No delivery items</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Check-In Dialog */}
      <Dialog open={checkInOpen} onOpenChange={setCheckInOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Check In</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Enter the number of empty bottles returned by the driver.
            </p>
            <div className="space-y-2">
              <Label>Empty Bottles Returned</Label>
              <Input
                type="number"
                min={0}
                value={emptiesReturned}
                onChange={(e) => setEmptiesReturned(Number(e.target.value))}
                placeholder="0"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCheckInOpen(false)}>Cancel</Button>
            <Button onClick={handleCheckIn} disabled={isCheckingIn}>
              {isCheckingIn ? 'Checking in...' : 'Confirm Check In'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
