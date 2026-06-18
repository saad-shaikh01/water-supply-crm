'use client';

import { Button } from '@water-supply-crm/ui';
import { StatusBadge } from '../../../components/shared/status-badge';
import { ArrowLeft, ArrowRightLeft, Download, MapPin, Printer, Truck } from 'lucide-react';

interface SheetDetailHeaderProps {
  date: string;
  routeName: string | null;
  vanPlateNumber: string | null;
  currentStatus: string;
  isClosed: boolean;
  isAdmin: boolean;
  isDriver: boolean;
  onBack: () => void;
  onSwap: () => void;
  onExportPdf: () => void;
  onPrintInvoice: () => void;
}

export function SheetDetailHeader({
  date,
  routeName,
  vanPlateNumber,
  currentStatus,
  isClosed,
  isAdmin,
  isDriver,
  onBack,
  onSwap,
  onExportPdf,
  onPrintInvoice,
}: SheetDetailHeaderProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-4">
      <Button variant="ghost" size="icon" onClick={onBack} className="rounded-full">
        <ArrowLeft className="h-5 w-5" />
      </Button>
      <div className="flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-xl sm:text-2xl font-black tracking-tight">
            {new Date(date).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
          </h1>
          <StatusBadge status={currentStatus} />
        </div>
        <div className="text-muted-foreground text-sm flex flex-wrap items-center gap-x-2 gap-y-1 mt-1 font-medium">
          <span className="flex items-center gap-1 whitespace-nowrap">
            <MapPin className="h-3 w-3 shrink-0" />
            {routeName ?? 'No Route'}
          </span>
          <span className="text-muted-foreground/40">•</span>
          <span className="flex items-center gap-1 whitespace-nowrap">
            <Truck className="h-3 w-3 shrink-0" />
            {vanPlateNumber}
          </span>
        </div>
      </div>
      <div className="flex gap-2">
        {!isClosed && isAdmin && (
          <Button
            variant="outline"
            size="icon"
            className="rounded-full"
            onClick={onSwap}
            title="Swap van assignment"
          >
            <ArrowRightLeft className="h-4 w-4" />
          </Button>
        )}
        {!isDriver && (
          <Button variant="outline" size="icon" className="rounded-full" onClick={onExportPdf} title="Download PDF">
            <Download className="h-4 w-4" />
          </Button>
        )}
        <Button variant="outline" size="icon" className="rounded-full" onClick={onPrintInvoice} title="Print Invoice">
          <Printer className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
