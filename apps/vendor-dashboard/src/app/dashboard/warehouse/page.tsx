'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Package, Droplets, AlertTriangle, Waves, Wrench, Truck, RotateCcw, Users, Loader2 } from 'lucide-react';
import { Button, Card, CardContent } from '@water-supply-crm/ui';
import { PageHeader } from '../../../components/shared/page-header';
import { StockCard } from '../../../features/warehouse/components/stock-card';
import { OpeningBalanceDialog } from '../../../features/warehouse/components/dialogs/opening-balance-dialog';
import { FillInDialog } from '../../../features/warehouse/components/dialogs/fill-in-dialog';
import { RefillDialog } from '../../../features/warehouse/components/dialogs/refill-dialog';
import { MarkDamagedDialog } from '../../../features/warehouse/components/dialogs/mark-damaged-dialog';
import { MarkLeakedDialog } from '../../../features/warehouse/components/dialogs/mark-leaked-dialog';
import { SendRepairDialog } from '../../../features/warehouse/components/dialogs/send-repair-dialog';
import { WriteOffDialog } from '../../../features/warehouse/components/dialogs/write-off-dialog';
import { AdjustmentDialog } from '../../../features/warehouse/components/dialogs/adjustment-dialog';
import { useWarehouseStock, useWarehouseUniverse } from '../../../features/warehouse/hooks/use-warehouse';
import { productsApi } from '../../../features/products/api/products.api';

type DialogType =
  | 'openingBalance'
  | 'fillIn'
  | 'refill'
  | 'markDamaged'
  | 'markLeaked'
  | 'sendRepair'
  | 'writeOff'
  | 'adjustment'
  | null;

function UniverseStat({
  label,
  value,
  icon: Icon,
  colorClass,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  colorClass: string;
}) {
  return (
    <Card className="border border-border/50 bg-card/50">
      <CardContent className="p-4 flex flex-col gap-2">
        <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${colorClass}`}>
          <Icon className="h-4 w-4" />
        </div>
        <p className="text-2xl font-black font-mono text-foreground dark:text-white">{value}</p>
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
}

export default function WarehousePage() {
  const [activeDialog, setActiveDialog] = useState<DialogType>(null);
  const { data: stock, isLoading: stockLoading } = useWarehouseStock();
  const { data: universe, isLoading: universeLoading } = useWarehouseUniverse();

  const { data: productsData } = useQuery({
    queryKey: ['warehouse-products-select'],
    queryFn: () => productsApi.getAll({ page: 1, limit: 100, isActive: true }).then((r) => r.data),
  });

  const products: { id: string; name: string }[] =
    (productsData as any)?.data ?? (productsData as any)?.items ?? [];

  const close = () => setActiveDialog(null);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Warehouse Inventory"
        description="Track and manage bottle stock across all states."
      />

      {/* Universe summary */}
      {universeLoading ? (
        <div className="flex items-center justify-center h-32">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : universe ? (
        <>
          <div className="rounded-2xl bg-primary/5 border border-primary/20 px-6 py-4 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Grand Total (All Bottles)</p>
              <p className="text-4xl font-black font-mono text-foreground dark:text-white mt-1">{universe.grandTotal}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
            <UniverseStat label="Filled" value={universe.warehouseFilled} icon={Droplets} colorClass="bg-blue-500/10 text-blue-500" />
            <UniverseStat label="Empty" value={universe.warehouseEmpty} icon={Package} colorClass="bg-muted text-muted-foreground" />
            <UniverseStat label="Damaged" value={universe.warehouseDamaged} icon={AlertTriangle} colorClass="bg-orange-500/10 text-orange-500" />
            <UniverseStat label="Leaked" value={universe.warehouseLeaked} icon={Waves} colorClass="bg-red-500/10 text-red-500" />
            <UniverseStat label="In Repair" value={universe.warehouseInRepair} icon={Wrench} colorClass="bg-purple-500/10 text-purple-500" />
            <UniverseStat label="Transit (Vans)" value={universe.vansInTransit} icon={Truck} colorClass="bg-indigo-500/10 text-indigo-500" />
            <UniverseStat label="Transit (Repair)" value={universe.repairBatchesInTransit} icon={RotateCcw} colorClass="bg-yellow-500/10 text-yellow-500" />
            <UniverseStat label="At Customers" value={universe.customersWalletTotal} icon={Users} colorClass="bg-teal-500/10 text-teal-500" />
          </div>
        </>
      ) : null}

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" className="rounded-xl font-bold text-xs gap-1.5" onClick={() => setActiveDialog('openingBalance')}>
          Set Opening Balance
        </Button>
        <Button variant="outline" className="rounded-xl font-bold text-xs gap-1.5 text-blue-500 border-blue-500/30 hover:bg-blue-500/10" onClick={() => setActiveDialog('fillIn')}>
          <Droplets className="h-3.5 w-3.5" /> Fill In
        </Button>
        <Button variant="outline" className="rounded-xl font-bold text-xs gap-1.5 text-emerald-500 border-emerald-500/30 hover:bg-emerald-500/10" onClick={() => setActiveDialog('refill')}>
          <RotateCcw className="h-3.5 w-3.5" /> Refill
        </Button>
        <Button variant="outline" className="rounded-xl font-bold text-xs gap-1.5 text-orange-500 border-orange-500/30 hover:bg-orange-500/10" onClick={() => setActiveDialog('markDamaged')}>
          <AlertTriangle className="h-3.5 w-3.5" /> Mark Damaged
        </Button>
        <Button variant="outline" className="rounded-xl font-bold text-xs gap-1.5 text-red-500 border-red-500/30 hover:bg-red-500/10" onClick={() => setActiveDialog('markLeaked')}>
          <Waves className="h-3.5 w-3.5" /> Mark Leaked
        </Button>
        <Button variant="outline" className="rounded-xl font-bold text-xs gap-1.5 text-purple-500 border-purple-500/30 hover:bg-purple-500/10" onClick={() => setActiveDialog('sendRepair')}>
          <Wrench className="h-3.5 w-3.5" /> Send for Repair
        </Button>
        <Button variant="outline" className="rounded-xl font-bold text-xs gap-1.5" onClick={() => setActiveDialog('writeOff')}>
          Write Off
        </Button>
        <Button variant="outline" className="rounded-xl font-bold text-xs gap-1.5 text-yellow-500 border-yellow-500/30 hover:bg-yellow-500/10" onClick={() => setActiveDialog('adjustment')}>
          Adjustment
        </Button>
      </div>

      {/* Per-product stock cards */}
      {stockLoading ? (
        <div className="flex items-center justify-center h-32">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {(stock ?? []).map((s) => (
            <StockCard key={s.id} stock={s} />
          ))}
          {(stock ?? []).length === 0 && (
            <p className="text-muted-foreground text-sm col-span-full py-8 text-center">No warehouse stock records found.</p>
          )}
        </div>
      )}

      {/* Dialogs */}
      <OpeningBalanceDialog open={activeDialog === 'openingBalance'} onOpenChange={(o) => !o && close()} products={products} />
      <FillInDialog open={activeDialog === 'fillIn'} onOpenChange={(o) => !o && close()} products={products} />
      <RefillDialog open={activeDialog === 'refill'} onOpenChange={(o) => !o && close()} products={products} />
      <MarkDamagedDialog open={activeDialog === 'markDamaged'} onOpenChange={(o) => !o && close()} products={products} />
      <MarkLeakedDialog open={activeDialog === 'markLeaked'} onOpenChange={(o) => !o && close()} products={products} />
      <SendRepairDialog open={activeDialog === 'sendRepair'} onOpenChange={(o) => !o && close()} products={products} />
      <WriteOffDialog open={activeDialog === 'writeOff'} onOpenChange={(o) => !o && close()} products={products} />
      <AdjustmentDialog open={activeDialog === 'adjustment'} onOpenChange={(o) => !o && close()} products={products} />
    </div>
  );
}
