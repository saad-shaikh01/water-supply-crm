'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@water-supply-crm/ui';
import { ArrowLeft, Eraser, MoreHorizontal, Pause, Pencil, Play, Trash2, Wrench } from 'lucide-react';
import { apiErrorMessage, useSuspendVendor, useUnsuspendVendor } from '../../hooks/use-vendors';
import { useProvisionVendor } from '../../hooks/use-vendor-detail';
import { VendorForm } from '../vendor-form';
import { WipeVendorDialog } from '../wipe-vendor-dialog';
import { DeleteVendorDialog } from '../delete-vendor-dialog';
import { VendorLiveBadge, VendorStatusBadge } from '../vendor-status-badges';
import { ConfirmDialog } from '../../../../components/shared/confirm-dialog';
import type { ProvisionResult, VendorRow } from '../../types';

const humanize = (k: string) => k.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());

export function VendorHeader({ vendor }: { vendor: VendorRow }) {
  const router = useRouter();
  const suspend = useSuspendVendor();
  const unsuspend = useUnsuspendVendor();
  const provision = useProvisionVendor(vendor.id);

  const [edit, setEdit] = useState(false);
  const [confirmSuspend, setConfirmSuspend] = useState(false);
  const [confirmRepair, setConfirmRepair] = useState(false);
  const [repairResult, setRepairResult] = useState<ProvisionResult | null>(null);
  const [wipe, setWipe] = useState(false);
  const [del, setDel] = useState(false);

  const active = vendor.isActive !== false;

  return (
    <div className="space-y-3">
      <Link href="/vendors" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Vendors
      </Link>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">{vendor.name}</h1>
            <VendorStatusBadge isActive={active} />
            <VendorLiveBadge live={!!vendor.goLiveAt} />
          </div>
          <p className="font-mono text-sm text-muted-foreground">{vendor.slug}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => setEdit(true)}>
            <Pencil className="mr-1 h-4 w-4" /> Edit
          </Button>
          {active ? (
            <Button variant="outline" onClick={() => setConfirmSuspend(true)}>
              <Pause className="mr-1 h-4 w-4" /> Suspend
            </Button>
          ) : (
            <Button variant="outline" disabled={unsuspend.isPending} onClick={() => unsuspend.mutate(vendor.id)}>
              <Play className="mr-1 h-4 w-4" /> Unsuspend
            </Button>
          )}
          <Button variant="outline" onClick={() => setConfirmRepair(true)}>
            <Wrench className="mr-1 h-4 w-4" /> Repair setup
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label="More actions">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setWipe(true)}>
                <Eraser className="mr-2 h-4 w-4" /> Wipe data
              </DropdownMenuItem>
              <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setDel(true)}>
                <Trash2 className="mr-2 h-4 w-4" /> Delete vendor
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <VendorForm open={edit} onOpenChange={setEdit} vendor={vendor} />
      <WipeVendorDialog vendor={wipe ? vendor : null} onOpenChange={(o) => !o && setWipe(false)} />
      <DeleteVendorDialog vendor={del ? vendor : null} onOpenChange={(o) => !o && setDel(false)} onDeleted={() => router.push('/vendors')} />

      <ConfirmDialog
        open={confirmSuspend}
        onOpenChange={setConfirmSuspend}
        title="Suspend Vendor"
        description={`"${vendor.name}" and all its users will be blocked from signing in or using the app until you unsuspend it.`}
        confirmLabel="Suspend"
        isPending={suspend.isPending}
        onConfirm={() => suspend.mutate(vendor.id, { onSuccess: () => setConfirmSuspend(false) })}
      />

      <ConfirmDialog
        open={confirmRepair}
        onOpenChange={setConfirmRepair}
        title="Repair vendor setup"
        description="Re-runs onboarding provisioning: missing system roles, preset permissions, role-less users and starter catalogues are filled in. Existing customised roles are never rewritten. Safe to run repeatedly."
        confirmLabel="Repair setup"
        isPending={provision.isPending}
        onConfirm={() =>
          provision.mutate(undefined, {
            onSuccess: (r) => {
              setConfirmRepair(false);
              setRepairResult(r);
            },
            onError: () => setConfirmRepair(false),
          })
        }
      />
      {provision.isError && !confirmRepair && !repairResult && (
        <p role="alert" className="text-sm text-destructive">
          {apiErrorMessage(provision.error, 'Repair failed.')}
        </p>
      )}

      <Dialog open={!!repairResult} onOpenChange={(o) => !o && setRepairResult(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Setup repaired</DialogTitle>
          </DialogHeader>
          <ul className="divide-y rounded-lg border text-sm" aria-label="Repair summary">
            {Object.entries(repairResult ?? {})
              .filter(([k]) => k !== 'vendorId')
              .map(([k, v]) => (
                <li key={k} className="flex justify-between px-3 py-1.5">
                  <span>{humanize(k)}</span>
                  <span className="font-mono tabular-nums">{Array.isArray(v) ? v.length : typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)}</span>
                </li>
              ))}
          </ul>
          <DialogFooter>
            <Button onClick={() => setRepairResult(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
