'use client';

import { useEffect, useMemo, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, Gauge, Wallet, Fuel, Pencil, Truck, Ban, RotateCcw } from 'lucide-react';
import {
  Card, CardContent, CardHeader, CardTitle, Button, Input, Label,
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@water-supply-crm/ui';
import type { VehicleDetail, VehicleCostSummary } from '../api/fleet.api';
import { vehicleProfileSchema, type VehicleProfileInput } from '../schemas';
import { useUpdateVehicleProfile, useDeactivateVehicle, useReactivateVehicle } from '../hooks/use-fleet';
import { useAllVans } from '../../vans/hooks/use-vans';
import { useCan } from '../../authz/hooks/use-can';
import { VehicleFormDialog } from './dialogs/vehicle-form-dialog';

const FUEL_TYPES = ['PETROL', 'DIESEL', 'CNG', 'HYBRID', 'ELECTRIC'] as const;
const OWNERSHIP_TYPES = ['OWNED', 'LEASED', 'RENTED', 'FINANCED'] as const;
const OPERATIONAL_STATUSES = ['ACTIVE', 'IN_MAINTENANCE', 'RETIRED'] as const;

interface VehicleOverviewTabProps {
  vehicle: VehicleDetail;
  costSummary?: VehicleCostSummary;
}

export function VehicleOverviewTab({ vehicle, costSummary }: VehicleOverviewTabProps) {
  const canUpdate = useCan('fleet:update');
  const profile = vehicle.vehicleProfile;
  const { mutate: updateProfile, isPending } = useUpdateVehicleProfile();
  const { mutate: deactivateVehicle, isPending: deactivating } = useDeactivateVehicle();
  const { mutate: reactivateVehicle, isPending: reactivating } = useReactivateVehicle();
  const { data: vansPage } = useAllVans();
  const [editOpen, setEditOpen] = useState(false);

  const usualVanLabel = useMemo(
    () => vansPage?.data.find((v) => v.id === vehicle.usualVanId)?.plateNumber,
    [vansPage, vehicle.usualVanId],
  );

  const { register, handleSubmit, reset, control, formState: { errors, isDirty } } = useForm<VehicleProfileInput>({
    resolver: zodResolver(vehicleProfileSchema),
    defaultValues: {
      make: profile?.make ?? '',
      model: profile?.model ?? '',
      year: profile?.year ?? null,
      color: profile?.color ?? '',
      chassisNumber: profile?.chassisNumber ?? '',
      engineNumber: profile?.engineNumber ?? '',
      fuelType: profile?.fuelType ?? null,
      transmissionType: profile?.transmissionType ?? '',
      loadCapacityKg: profile?.loadCapacityKg ?? null,
      seatingCapacity: profile?.seatingCapacity ?? null,
      ownershipType: profile?.ownershipType ?? null,
      purchaseDate: profile?.purchaseDate ? profile.purchaseDate.slice(0, 10) : '',
      purchaseCost: profile?.purchaseCost ?? null,
      supplierName: profile?.supplierName ?? '',
      operationalStatus: profile?.operationalStatus ?? 'ACTIVE',
    },
  });

  useEffect(() => {
    reset({
      make: profile?.make ?? '',
      model: profile?.model ?? '',
      year: profile?.year ?? null,
      color: profile?.color ?? '',
      chassisNumber: profile?.chassisNumber ?? '',
      engineNumber: profile?.engineNumber ?? '',
      fuelType: profile?.fuelType ?? null,
      transmissionType: profile?.transmissionType ?? '',
      loadCapacityKg: profile?.loadCapacityKg ?? null,
      seatingCapacity: profile?.seatingCapacity ?? null,
      ownershipType: profile?.ownershipType ?? null,
      purchaseDate: profile?.purchaseDate ? profile.purchaseDate.slice(0, 10) : '',
      purchaseCost: profile?.purchaseCost ?? null,
      supplierName: profile?.supplierName ?? '',
      operationalStatus: profile?.operationalStatus ?? 'ACTIVE',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.updatedAt]);

  function onSubmit(values: VehicleProfileInput) {
    updateProfile({ vehicleId: vehicle.id, data: { ...values, version: profile?.version } });
  }

  return (
    <div className="space-y-6">
      <Card className="rounded-2xl">
        <CardContent className="p-5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <Truck className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-widest font-semibold">Number Plate</p>
              <p className="text-lg font-black">{vehicle.plateNumber}</p>
              <p className="text-xs text-muted-foreground">
                Usually serves:{' '}
                {usualVanLabel ? <span className="font-semibold text-foreground">{usualVanLabel}</span> : 'no usual route set'}
              </p>
            </div>
          </div>
          {canUpdate && (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setEditOpen(true)} className="rounded-xl font-bold gap-1.5">
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </Button>
              {vehicle.isActive ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={deactivating}
                  onClick={() => deactivateVehicle(vehicle.id)}
                  className="rounded-xl font-bold gap-1.5"
                >
                  <Ban className="h-3.5 w-3.5" />
                  Deactivate
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={reactivating}
                  onClick={() => reactivateVehicle(vehicle.id)}
                  className="rounded-xl font-bold gap-1.5"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Reactivate
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <VehicleFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        vehicle={{ id: vehicle.id, plateNumber: vehicle.plateNumber, usualVanId: vehicle.usualVanId }}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="rounded-2xl">
          <CardContent className="p-5 flex items-center gap-3">
            <Gauge className="h-6 w-6 text-primary" />
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-widest font-semibold">Odometer</p>
              <p className="text-xl font-black">{(profile?.currentOdometer ?? 0).toLocaleString()} km</p>
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl">
          <CardContent className="p-5 flex items-center gap-3">
            <Wallet className="h-6 w-6 text-primary" />
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-widest font-semibold">Total Cost</p>
              <p className="text-xl font-black">₨{(costSummary?.totalCost ?? 0).toLocaleString()}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl">
          <CardContent className="p-5 flex items-center gap-3">
            <Fuel className="h-6 w-6 text-primary" />
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-widest font-semibold">Fuel Average</p>
              <p className="text-xl font-black">
                {costSummary?.fuelAvgKmPerLiter != null
                  ? `${costSummary.fuelAvgKmPerLiter.toFixed(1)} km/L`
                  : '—'}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-2xl">
        <CardHeader>
          <CardTitle className="text-lg font-black">Vehicle Master</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>Make</Label>
                <Input className="rounded-xl" disabled={!canUpdate} {...register('make')} />
              </div>
              <div className="space-y-2">
                <Label>Model</Label>
                <Input className="rounded-xl" disabled={!canUpdate} {...register('model')} />
              </div>
              <div className="space-y-2">
                <Label>Year</Label>
                <Controller
                  name="year"
                  control={control}
                  render={({ field }) => (
                    <Input
                      type="number"
                      className="rounded-xl"
                      disabled={!canUpdate}
                      value={field.value ?? ''}
                      onChange={(e) => field.onChange(e.target.value === '' ? null : Number(e.target.value))}
                    />
                  )}
                />
              </div>
              <div className="space-y-2">
                <Label>Color</Label>
                <Input className="rounded-xl" disabled={!canUpdate} {...register('color')} />
              </div>
              <div className="space-y-2">
                <Label>Chassis Number</Label>
                <Input className="rounded-xl" disabled={!canUpdate} {...register('chassisNumber')} />
              </div>
              <div className="space-y-2">
                <Label>Engine Number</Label>
                <Input className="rounded-xl" disabled={!canUpdate} {...register('engineNumber')} />
              </div>
              <div className="space-y-2">
                <Label>Fuel Type</Label>
                <Controller
                  name="fuelType"
                  control={control}
                  render={({ field }) => (
                    <Select value={field.value ?? undefined} onValueChange={field.onChange} disabled={!canUpdate}>
                      <SelectTrigger className="rounded-xl"><SelectValue placeholder="Select…" /></SelectTrigger>
                      <SelectContent>
                        {FUEL_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
              <div className="space-y-2">
                <Label>Transmission</Label>
                <Input className="rounded-xl" disabled={!canUpdate} {...register('transmissionType')} />
              </div>
              <div className="space-y-2">
                <Label>Load Capacity (kg)</Label>
                <Controller
                  name="loadCapacityKg"
                  control={control}
                  render={({ field }) => (
                    <Input
                      type="number"
                      className="rounded-xl"
                      disabled={!canUpdate}
                      value={field.value ?? ''}
                      onChange={(e) => field.onChange(e.target.value === '' ? null : Number(e.target.value))}
                    />
                  )}
                />
              </div>
              <div className="space-y-2">
                <Label>Ownership</Label>
                <Controller
                  name="ownershipType"
                  control={control}
                  render={({ field }) => (
                    <Select value={field.value ?? undefined} onValueChange={field.onChange} disabled={!canUpdate}>
                      <SelectTrigger className="rounded-xl"><SelectValue placeholder="Select…" /></SelectTrigger>
                      <SelectContent>
                        {OWNERSHIP_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
              <div className="space-y-2">
                <Label>Purchase Date</Label>
                <Input type="date" className="rounded-xl" disabled={!canUpdate} {...register('purchaseDate')} />
              </div>
              <div className="space-y-2">
                <Label>Purchase Cost (₨)</Label>
                <Controller
                  name="purchaseCost"
                  control={control}
                  render={({ field }) => (
                    <Input
                      type="number"
                      className="rounded-xl"
                      disabled={!canUpdate}
                      value={field.value ?? ''}
                      onChange={(e) => field.onChange(e.target.value === '' ? null : Number(e.target.value))}
                    />
                  )}
                />
              </div>
              <div className="space-y-2">
                <Label>Supplier</Label>
                <Input className="rounded-xl" disabled={!canUpdate} {...register('supplierName')} />
              </div>
              <div className="space-y-2">
                <Label>Operational Status</Label>
                <Controller
                  name="operationalStatus"
                  control={control}
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange} disabled={!canUpdate}>
                      <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {OPERATIONAL_STATUSES.map((t) => <SelectItem key={t} value={t}>{t.replace('_', ' ')}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
            </div>

            {canUpdate && (
              <div className="flex justify-end">
                <Button type="submit" disabled={isPending || !isDirty} className="rounded-xl font-bold">
                  {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Save Changes
                </Button>
              </div>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
