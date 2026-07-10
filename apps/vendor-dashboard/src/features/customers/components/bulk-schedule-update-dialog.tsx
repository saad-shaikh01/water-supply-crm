'use client';

import { useState } from 'react';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter, SheetDescription,
  Button, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@water-supply-crm/ui';
import { CalendarClock, Truck } from 'lucide-react';
import { ConfirmDialog } from '../../../components/shared/confirm-dialog';
import { useAllVans } from '../../vans/hooks/use-vans';
import { useBulkUpdateSchedule } from '../hooks/use-customers';

const DAYS = [
  { label: 'Monday', value: 1 },
  { label: 'Tuesday', value: 2 },
  { label: 'Wednesday', value: 3 },
  { label: 'Thursday', value: 4 },
  { label: 'Friday', value: 5 },
  { label: 'Saturday', value: 6 },
];

const NONE = '__none__';

interface BulkScheduleUpdateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerIds: string[];
  onSuccess?: () => void;
}

export function BulkScheduleUpdateDialog({ open, onOpenChange, customerIds, onSuccess }: BulkScheduleUpdateDialogProps) {
  const { data: vansResponse } = useAllVans();
  const vans = (vansResponse?.data as Array<{ id: string; plateNumber: string }>) ?? [];

  const [vanId, setVanId] = useState('');
  const [dayOfWeek, setDayOfWeek] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);

  const { mutate: bulkUpdate, isPending } = useBulkUpdateSchedule();

  const count = customerIds.length;
  const canSubmit = count > 0 && (!!vanId || !!dayOfWeek);

  const reset = () => {
    setVanId('');
    setDayOfWeek('');
  };

  const handleClose = (o: boolean) => {
    if (!o) reset();
    onOpenChange(o);
  };

  const handleConfirmedUpdate = () => {
    bulkUpdate(
      {
        customerIds,
        vanId: vanId || undefined,
        dayOfWeek: dayOfWeek ? Number(dayOfWeek) : undefined,
      },
      {
        onSuccess: () => {
          setConfirmOpen(false);
          reset();
          onOpenChange(false);
          onSuccess?.();
        },
        onError: () => setConfirmOpen(false),
      },
    );
  };

  const vanLabel = vanId ? vans.find((v) => v.id === vanId)?.plateNumber ?? vanId : null;
  const dayLabel = dayOfWeek ? DAYS.find((d) => String(d.value) === dayOfWeek)?.label : null;

  return (
    <>
      <Sheet open={open} onOpenChange={handleClose}>
        <SheetContent className="w-full sm:max-w-md bg-background/95 backdrop-blur-xl border-l border-border/50 flex flex-col gap-0 p-0">
          <SheetHeader className="px-6 pt-6 pb-6 border-b shrink-0">
            <SheetTitle className="text-2xl font-bold flex items-center gap-2">
              <CalendarClock className="h-6 w-6 text-primary" />
              Bulk Schedule Update
            </SheetTitle>
            <SheetDescription>
              Update the assigned van and/or delivery day for {count} selected customer{count !== 1 ? 's' : ''}.
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-6 py-8 space-y-6">
            <div className="space-y-2">
              <Label className="text-sm font-semibold">Assigned Van</Label>
              <Select value={vanId || NONE} onValueChange={(v) => setVanId(v === NONE ? '' : v)}>
                <SelectTrigger className="bg-accent/30 border-border/50 h-11 focus:border-primary/50 transition-all">
                  <SelectValue placeholder="Don't change" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Don't change</SelectItem>
                  {vans.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      <div className="flex items-center gap-2">
                        <Truck className="h-3 w-3" />
                        {v.plateNumber}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-semibold">Delivery Day</Label>
              <Select value={dayOfWeek || NONE} onValueChange={(v) => setDayOfWeek(v === NONE ? '' : v)}>
                <SelectTrigger className="bg-accent/30 border-border/50 h-11 focus:border-primary/50 transition-all">
                  <SelectValue placeholder="Don't change" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Don't change</SelectItem>
                  {DAYS.map((d) => (
                    <SelectItem key={d.value} value={String(d.value)}>{d.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground mt-1">
                Setting a delivery day replaces each customer's entire schedule with a single visit on that day.
              </p>
            </div>
          </div>

          <SheetFooter className="px-6 py-4 border-t gap-3 sm:gap-0 shrink-0">
            <Button type="button" variant="ghost" onClick={() => handleClose(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              className="min-w-[160px] shadow-lg shadow-primary/20"
              disabled={!canSubmit || isPending}
              onClick={() => setConfirmOpen(true)}
            >
              {isPending ? 'Updating...' : `Update ${count} Customer${count !== 1 ? 's' : ''}`}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Confirm Bulk Schedule Update"
        description={
          `You are about to update ${count} customer${count !== 1 ? 's' : ''}` +
          (vanLabel ? ` — van: ${vanLabel}` : '') +
          (dayLabel ? ` — delivery day: ${dayLabel}` : '') +
          '. This cannot be undone. Are you sure?'
        }
        onConfirm={handleConfirmedUpdate}
        isLoading={isPending}
        confirmLabel="Confirm Update"
        variant="default"
      />
    </>
  );
}
