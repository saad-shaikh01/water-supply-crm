'use client';

import { Card, CardContent } from '@water-supply-crm/ui';
import { Droplets, Package, AlertTriangle, Waves, Wrench } from 'lucide-react';
import type { WarehouseStock } from '../api/warehouse.api';

interface StockCardProps {
  stock: WarehouseStock;
}

export function StockCard({ stock }: StockCardProps) {
  return (
    <Card className="border border-border/50 bg-card/50 overflow-hidden">
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-black text-base text-foreground dark:text-white">{stock.product.name}</h3>
            <p className="text-[10px] text-muted-foreground/60 font-mono uppercase tracking-widest mt-0.5">
              {stock.product.isActive ? 'Active' : 'Inactive'}
            </p>
          </div>
          <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
            <Package className="h-5 w-5 text-primary" />
          </div>
        </div>

        <div className="grid grid-cols-5 gap-2">
          {/* Filled */}
          <div className="flex flex-col items-center gap-1 rounded-xl bg-blue-500/10 border border-blue-500/20 px-2 py-3">
            <Droplets className="h-4 w-4 text-blue-500" />
            <span className="text-lg font-black font-mono text-blue-500">{stock.filledCount}</span>
            <span className="text-[9px] font-bold uppercase tracking-widest text-blue-500/70">Filled</span>
          </div>

          {/* Empty */}
          <div className="flex flex-col items-center gap-1 rounded-xl bg-muted/30 border border-border/30 px-2 py-3">
            <Package className="h-4 w-4 text-muted-foreground" />
            <span className="text-lg font-black font-mono text-muted-foreground">{stock.emptyCount}</span>
            <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/70">Empty</span>
          </div>

          {/* Damaged */}
          <div className="flex flex-col items-center gap-1 rounded-xl bg-orange-500/10 border border-orange-500/20 px-2 py-3">
            <AlertTriangle className="h-4 w-4 text-orange-500" />
            <span className="text-lg font-black font-mono text-orange-500">{stock.damagedCount}</span>
            <span className="text-[9px] font-bold uppercase tracking-widest text-orange-500/70">Damaged</span>
          </div>

          {/* Leaked */}
          <div className="flex flex-col items-center gap-1 rounded-xl bg-red-500/10 border border-red-500/20 px-2 py-3">
            <Waves className="h-4 w-4 text-red-500" />
            <span className="text-lg font-black font-mono text-red-500">{stock.leakedCount}</span>
            <span className="text-[9px] font-bold uppercase tracking-widest text-red-500/70">Leaked</span>
          </div>

          {/* In Repair */}
          <div className="flex flex-col items-center gap-1 rounded-xl bg-purple-500/10 border border-purple-500/20 px-2 py-3">
            <Wrench className="h-4 w-4 text-purple-500" />
            <span className="text-lg font-black font-mono text-purple-500">{stock.inRepairCount}</span>
            <span className="text-[9px] font-bold uppercase tracking-widest text-purple-500/70">Repair</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
