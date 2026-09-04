'use client';

import { useState } from 'react';
import { Truck } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@water-supply-crm/ui';
import { useActiveVehiclesForPicker } from '../../fleet/hooks/use-fleet';

interface VehiclePickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (vehicleId: string) => void;
}

/**
 * Mandatory intermediate step for Fuel / Vehicle Maintenance — both target
 * dialogs need a concrete `vehicleId` before they can render their form body.
 *
 * Uses `useActiveVehiclesForPicker` (not the paginated/nuqs-bound `useVehicles`)
 * deliberately: `useVehicles` binds its `page`/`limit`/`search` state to the
 * SAME URL query keys the Expenses page's own timeline pagination already
 * uses (see `ExpenseTimeline`) — mounting it here would fight over that state.
 */
export function VehiclePickerDialog({ open, onOpenChange, onSelect }: VehiclePickerDialogProps) {
  const { data, isLoading } = useActiveVehiclesForPicker();
  const [vehicleId, setVehicleId] = useState('');

  const vehicles = data?.data ?? [];

  const handleContinue = () => {
    if (!vehicleId) return;
    onSelect(vehicleId);
    setVehicleId('');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-3xl max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <Truck className="h-5 w-5 text-primary" />
            Select Vehicle
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-2 py-2">
          <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
            Vehicle <span className="text-destructive">*</span>
          </Label>
          <Select value={vehicleId} onValueChange={setVehicleId} disabled={isLoading}>
            <SelectTrigger className="h-10 rounded-xl">
              <SelectValue placeholder={isLoading ? 'Loading vehicles…' : 'Select a vehicle'} />
            </SelectTrigger>
            <SelectContent>
              {vehicles.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {v.plateNumber}
                  {v.profile?.make || v.profile?.model
                    ? ` — ${[v.profile.make, v.profile.model].filter(Boolean).join(' ')}`
                    : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!isLoading && vehicles.length === 0 && (
            <p className="text-xs text-muted-foreground">No active vehicles found.</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleContinue} disabled={!vehicleId} className="rounded-xl font-bold">
            Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
