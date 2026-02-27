'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Textarea,
} from '@water-supply-crm/ui';
import { CalendarClock, Truck } from 'lucide-react';
import { useAllVans } from '../../vans/hooks/use-vans';
import { useAllDrivers } from '../../users/hooks/use-users';
import { dailySheetsApi } from '../../daily-sheets/api/daily-sheets.api';

const DISPATCH_MODE_OPTIONS = [
  { value: 'INSERT_IN_OPEN_SHEET', label: 'Insert In Open Sheet' },
  { value: 'QUEUE_FOR_GENERATION', label: 'Queue For Generation' },
];

interface OrderDispatchDrawerProps {
  order: any;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (data: {
    targetDate: string;
    timeWindow?: string;
    vanId?: string;
    driverId?: string;
    dispatchMode: string;
    notes?: string;
    targetSheetId?: string;
  }) => void;
  onDispatchNow: () => void;
  isSaving?: boolean;
  isDispatching?: boolean;
}

export function OrderDispatchDrawer({
  order,
  open,
  onOpenChange,
  onSave,
  onDispatchNow,
  isSaving,
  isDispatching,
}: OrderDispatchDrawerProps) {
  const { data: vansData } = useAllVans();
  const { data: driversData } = useAllDrivers();
  const [form, setForm] = useState({
    targetDate: '',
    timeWindow: '',
    vanId: '',
    driverId: '',
    dispatchMode: 'QUEUE_FOR_GENERATION',
    notes: '',
    targetSheetId: '',
  });

  const vans = ((vansData as any)?.data ?? []) as Array<{ id: string; plateNumber: string }>;
  const drivers = ((driversData as any)?.data ?? []) as Array<{ id: string; name: string }>;

  const { data: openSheetsData } = useQuery({
    queryKey: ['order-dispatch-open-sheets', form.targetDate, form.vanId],
    queryFn: () =>
      dailySheetsApi.getAll({
        page: 1,
        limit: 100,
        date: form.targetDate,
        vanId: form.vanId || undefined,
        isClosed: false,
      }).then((r) => r.data),
    enabled: open && form.dispatchMode === 'INSERT_IN_OPEN_SHEET' && !!form.targetDate,
  });

  const openSheets = useMemo(
    () => ((openSheetsData as any)?.data ?? []) as Array<{ id: string; route?: { name: string }; van?: { plateNumber: string }; driver?: { name: string } }>,
    [openSheetsData],
  );

  useEffect(() => {
    if (!order || !open) return;

    setForm({
      targetDate: order.targetDate ? new Date(order.targetDate).toISOString().slice(0, 10) : '',
      timeWindow: order.timeWindow ?? '',
      vanId: order.dispatchVanId ?? '',
      driverId: order.dispatchDriverId ?? '',
      dispatchMode: order.dispatchMode ?? 'QUEUE_FOR_GENERATION',
      notes: order.dispatchNotes ?? '',
      targetSheetId: '',
    });
  }, [order, open]);

  useEffect(() => {
    setForm((prev) => ({ ...prev, targetSheetId: '' }));
  }, [form.targetDate, form.vanId, form.dispatchMode]);

  const needsSheetSelection = form.dispatchMode === 'INSERT_IN_OPEN_SHEET';
  const canSave = !!form.targetDate && !!form.dispatchMode && (!needsSheetSelection || !!form.targetSheetId);
  const canDispatchNow = order?.status === 'APPROVED' && order?.dispatchStatus !== 'INSERTED_IN_SHEET';

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg bg-background/95 backdrop-blur-xl border-l border-border/50 overflow-y-auto">
        <SheetHeader className="pb-6 border-b">
          <SheetTitle className="flex items-center gap-2 text-lg font-bold">
            <Truck className="h-5 w-5 text-primary" /> Dispatch Plan
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-6 py-6">
          <div className="rounded-2xl bg-accent/30 p-4 border border-border/40 space-y-1.5">
            <p className="text-sm font-bold">{order?.customer?.name}</p>
            <p className="text-xs text-muted-foreground">{order?.product?.name} x {order?.quantity}</p>
            <p className="text-[11px] text-muted-foreground">Current dispatch status: {order?.dispatchStatus ?? 'UNPLANNED'}</p>
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Target Date</Label>
            <Input
              type="date"
              value={form.targetDate}
              onChange={(event) => setForm((prev) => ({ ...prev, targetDate: event.target.value }))}
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Dispatch Mode</Label>
            <Select
              value={form.dispatchMode}
              onValueChange={(value) => setForm((prev) => ({ ...prev, dispatchMode: value }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DISPATCH_MODE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {needsSheetSelection && (
            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Open Sheet</Label>
              <Select
                value={form.targetSheetId || 'none'}
                onValueChange={(value) => setForm((prev) => ({ ...prev, targetSheetId: value === 'none' ? '' : value }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select an open sheet" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Select an open sheet</SelectItem>
                  {openSheets.map((sheet) => (
                    <SelectItem key={sheet.id} value={sheet.id}>
                      {(sheet.route?.name ?? 'No Route')} | {(sheet.van?.plateNumber ?? '-')} | {(sheet.driver?.name ?? '-')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.targetDate && openSheets.length === 0 && (
                <p className="text-[11px] text-muted-foreground">No open sheets found for the selected date and van.</p>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Time Window</Label>
            <Input
              value={form.timeWindow}
              onChange={(event) => setForm((prev) => ({ ...prev, timeWindow: event.target.value }))}
              placeholder="e.g. 10:00 AM - 12:00 PM"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Assign Van</Label>
              <Select value={form.vanId || 'none'} onValueChange={(value) => setForm((prev) => ({ ...prev, vanId: value === 'none' ? '' : value }))}>
                <SelectTrigger>
                  <SelectValue placeholder="No van assigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No van assigned</SelectItem>
                  {vans.map((van) => (
                    <SelectItem key={van.id} value={van.id}>{van.plateNumber}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Assign Driver</Label>
              <Select value={form.driverId || 'none'} onValueChange={(value) => setForm((prev) => ({ ...prev, driverId: value === 'none' ? '' : value }))}>
                <SelectTrigger>
                  <SelectValue placeholder="No driver assigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No driver assigned</SelectItem>
                  {drivers.map((driver) => (
                    <SelectItem key={driver.id} value={driver.id}>{driver.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Dispatch Notes</Label>
            <Textarea
              rows={4}
              value={form.notes}
              onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
              placeholder="Planning notes for ops..."
            />
          </div>

          <div className="rounded-2xl border border-border/40 bg-card/30 p-4 text-xs text-muted-foreground flex gap-3">
            <CalendarClock className="h-4 w-4 mt-0.5 text-primary shrink-0" />
            Approval only changes the order state to approved. Dispatch remains separate until you save a plan or insert it into a live sheet.
          </div>

          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} className="flex-1">
              Close
            </Button>
            <Button
              variant="outline"
              disabled={!canDispatchNow || isDispatching}
              onClick={onDispatchNow}
              className="flex-1"
            >
              Dispatch Now
            </Button>
            <Button
              disabled={!canSave || isSaving}
              onClick={() => onSave({
                targetDate: form.targetDate,
                timeWindow: form.timeWindow || undefined,
                vanId: form.vanId || undefined,
                driverId: form.driverId || undefined,
                dispatchMode: form.dispatchMode,
                notes: form.notes || undefined,
                targetSheetId: form.targetSheetId || undefined,
              })}
              className="flex-1"
            >
              {needsSheetSelection ? 'Save and Insert' : 'Save Plan'}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
