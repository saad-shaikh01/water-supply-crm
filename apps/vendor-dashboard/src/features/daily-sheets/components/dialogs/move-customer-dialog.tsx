'use client';

import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button, Label, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@water-supply-crm/ui';
import { Loader2, Truck, ArrowRightCircle } from 'lucide-react';
import { useMoveDeliveryItems, useDestinationOptions } from '../../hooks/use-daily-sheets';

export interface MoveCustomerTarget {
  id: string; // DailySheetItem id
  customerName: string;
}

interface MoveCustomerDialogProps {
  open: boolean;
  onClose: () => void;
  /** Source sheet id — used to invalidate its query after a successful move. */
  sheetId: string;
  /** Source sheet's date (ISO string) — the destination date field defaults here. */
  sourceDate: string;
  sourceVanId?: string | null;
  items: MoveCustomerTarget[];
  onMoved?: () => void;
}

const todayStr = () => new Date().toISOString().slice(0, 10);

export function MoveCustomerDialog({
  open, onClose, sheetId, sourceDate, sourceVanId, items, onMoved,
}: MoveCustomerDialogProps) {
  const { mutate: moveItems, isPending } = useMoveDeliveryItems(sheetId);

  const defaultDate = sourceDate ? sourceDate.slice(0, 10) : todayStr();
  const [destinationDate, setDestinationDate] = useState(defaultDate);
  const [destinationVanId, setDestinationVanId] = useState('');

  // Reset the form to the source sheet's own date each time the dialog opens.
  useEffect(() => {
    if (open) {
      setDestinationDate(defaultDate);
      setDestinationVanId('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const { data: options, isLoading: loadingOptions } = useDestinationOptions(destinationDate, open);

  const handleClose = () => onClose();

  const handleMove = () => {
    if (!destinationVanId) return;
    moveItems(
      { itemIds: items.map((i) => i.id), destinationVanId, destinationDate },
      { onSuccess: () => { handleClose(); onMoved?.(); } },
    );
  };

  const selectedOption = options?.find((o) => o.vanId === destinationVanId);
  const isSameAsSource = !!sourceVanId && destinationVanId === sourceVanId && destinationDate === defaultDate;
  const destinationClosed = !!selectedOption?.hasSheetForDate && selectedOption.isClosed;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="rounded-3xl max-w-sm max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <ArrowRightCircle className="h-5 w-5 text-primary" />
            Move {items.length > 1 ? `${items.length} Customers` : 'Customer'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-4">
          {items.length > 1 ? (
            <div className="p-3 rounded-2xl bg-accent/20 border border-border/30 max-h-32 overflow-y-auto">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5">
                Moving {items.length} deliveries
              </p>
              <ul className="space-y-0.5">
                {items.map((i) => (
                  <li key={i.id} className="text-xs font-medium">{i.customerName}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-sm">
              Moving <span className="font-bold">{items[0]?.customerName}</span>
            </p>
          )}

          <div className="space-y-3 p-4 rounded-2xl bg-accent/20 border border-border/30">
            <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
              Destination Date
            </Label>
            <Input
              type="date"
              className="h-10"
              min={todayStr()}
              value={destinationDate}
              onChange={(e) => { setDestinationDate(e.target.value); setDestinationVanId(''); }}
            />
          </div>

          <div className="space-y-3 p-4 rounded-2xl bg-accent/20 border border-border/30">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Truck className="h-3.5 w-3.5" />
              <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
                Destination Van
              </Label>
            </div>
            <Select value={destinationVanId} onValueChange={setDestinationVanId} disabled={loadingOptions}>
              <SelectTrigger className="h-10">
                <SelectValue placeholder={loadingOptions ? 'Loading vans…' : 'Select a van'} />
              </SelectTrigger>
              <SelectContent>
                {(options ?? []).map((o) => {
                  const closed = o.hasSheetForDate && o.isClosed;
                  return (
                    <SelectItem key={o.vanId} value={o.vanId} disabled={closed}>
                      {o.plateNumber}
                      {o.driverName ? ` — ${o.driverName}` : ''}
                      {closed ? ' (closed)' : !o.hasSheetForDate ? ' (new sheet)' : ''}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>

            {selectedOption && !destinationClosed && (
              <p className="text-[11px] text-muted-foreground">
                {selectedOption.hasSheetForDate
                  ? "Adds to this van's existing open sheet."
                  : 'A new sheet will be created for this van and date.'}
              </p>
            )}
            {isSameAsSource && (
              <p className="text-[11px] text-destructive font-medium">
                Already on this van&apos;s sheet for this date — pick a different van or date.
              </p>
            )}
          </div>

          <p className="text-[11px] text-muted-foreground bg-muted/40 rounded-xl px-3 py-2">
            Moved delivery starts as Pending on the destination. This does not change the
            customer&apos;s regular delivery schedule.
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={handleClose}>Cancel</Button>
          <Button
            onClick={handleMove}
            disabled={isPending || !destinationVanId || isSameAsSource || destinationClosed}
            className="rounded-xl font-bold"
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Move {items.length > 1 ? `${items.length} Customers` : 'Customer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
