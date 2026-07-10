'use client';

import { Button } from '@water-supply-crm/ui';
import { StatusBadge } from '../../../components/shared/status-badge';
import { ArrowLeft, ArrowRightLeft, Download, MapPin, Printer, ShieldAlert, ShieldCheck, Truck, User, Users } from 'lucide-react';
import type { SheetCrewMember } from '@water-supply-crm/types';

interface SheetDetailHeaderProps {
  date: string;
  routeName: string | null;
  vanPlateNumber: string | null;
  driverName: string | null;
  crew: SheetCrewMember[];
  crewConfirmed: boolean;
  crewConfirmedByName: string | null;
  currentStatus: string;
  isClosed: boolean;
  canEditCrew: boolean;
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
  driverName,
  crew,
  crewConfirmed,
  crewConfirmedByName,
  currentStatus,
  isClosed,
  canEditCrew,
  isDriver,
  onBack,
  onSwap,
  onExportPdf,
  onPrintInvoice,
}: SheetDetailHeaderProps) {
  const salesmen = crew.filter((c) => c.role === 'SALESMAN');
  const loaders = crew.filter((c) => c.role === 'LOADER');

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
        {/* Crew line */}
        <div className="text-muted-foreground text-xs flex flex-wrap items-center gap-x-2 gap-y-1 mt-1.5 font-medium">
          <span className="flex items-center gap-1 whitespace-nowrap">
            <User className="h-3 w-3 shrink-0" />
            Driver: <span className="font-bold text-foreground">{driverName ?? '—'}</span>
          </span>
          {salesmen.length > 0 && (
            <>
              <span className="text-muted-foreground/40">•</span>
              <span className="whitespace-nowrap">
                Salesm{salesmen.length > 1 ? 'en' : 'an'}:{' '}
                <span className="font-bold text-foreground">
                  {salesmen.map((s) => s.user.name).join(', ')}
                </span>
              </span>
            </>
          )}
          {loaders.length > 0 && (
            <>
              <span className="text-muted-foreground/40">•</span>
              <span className="flex items-center gap-1">
                <Users className="h-3 w-3 shrink-0" />
                Loader{loaders.length > 1 ? 's' : ''}:{' '}
                <span className="font-bold text-foreground">
                  {loaders.map((l) => l.user.name).join(', ')}
                </span>
              </span>
            </>
          )}
          <span className="text-muted-foreground/40">•</span>
          {crewConfirmed ? (
            <span
              className="flex items-center gap-1 text-emerald-600 font-bold whitespace-nowrap"
              title={crewConfirmedByName ? `Confirmed by ${crewConfirmedByName}` : undefined}
            >
              <ShieldCheck className="h-3 w-3 shrink-0" />
              Crew confirmed
            </span>
          ) : (
            <span className="flex items-center gap-1 text-amber-600 font-bold whitespace-nowrap">
              <ShieldAlert className="h-3 w-3 shrink-0" />
              Crew not confirmed
            </span>
          )}
        </div>
      </div>
      <div className="flex gap-2">
        {!isClosed && canEditCrew && (
          <Button
            variant="outline"
            size="icon"
            className="rounded-full"
            onClick={onSwap}
            title="Edit crew & assignment"
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
