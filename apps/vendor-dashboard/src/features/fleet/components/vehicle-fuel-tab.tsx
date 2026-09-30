'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Plus, Fuel, CreditCard, Banknote, User as UserIcon, ExternalLink, Pencil, Route, Gauge, ChevronLeft, ChevronRight,
} from 'lucide-react';
import {
  Card, CardContent, Button, Badge, Skeleton, Input,
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@water-supply-crm/ui';
import type { FuelLogEntry } from '@water-supply-crm/types';
import { useFuelLogs } from '../hooks/use-fuel-logs';
import { FuelLogFormDialog } from './dialogs/fuel-log-form-dialog';
import { useCan } from '../../authz/hooks/use-can';
import { fmtDate, fmtDateTime, fmtMoney, fmtNum } from '../lib/fleet-format';
import type { FleetPeriod } from './fleet-period-picker';

interface VehicleFuelTabProps {
  vehicleId: string;
  period: FleetPeriod;
}

const PAGE_SIZE = 20;

function FuelLogRow({ log, canEdit, onEdit }: { log: FuelLogEntry; canEdit: boolean; onEdit: () => void }) {
  return (
    <Card className="rounded-2xl">
      <CardContent className="p-4 space-y-2.5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <Fuel className="h-5 w-5 text-muted-foreground shrink-0" />
            <div>
              <p className="font-semibold text-sm">
                {fmtNum(log.litersFilled, 1)} L — {fmtMoney(log.amountPaid)}
                {log.pricePerLiter != null && (
                  <span className="ml-2 text-xs font-normal text-muted-foreground">₨{fmtNum(log.pricePerLiter, 1)}/L</span>
                )}
              </p>
              <p className="text-xs text-muted-foreground">
                {fmtDateTime(log.createdAt)} · fill dated {fmtDate(log.date)}
                {log.fuelStation ? ` · ${log.fuelStation}` : ''}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {log.fuelCard ? (
              <Badge className="text-[11px] border-none bg-blue-500/10 text-blue-600 gap-1">
                <CreditCard className="h-3 w-3" />
                {log.fuelCard.name}
              </Badge>
            ) : log.paidFromCash === false ? (
              <Badge className="text-[11px] border-none bg-blue-500/10 text-blue-600 gap-1">
                <CreditCard className="h-3 w-3" />
                Card / Bank
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[11px] gap-1">
                <Banknote className="h-3 w-3" />
                Van cash
              </Badge>
            )}
            {!log.isFullTank && <Badge variant="outline" className="text-[11px]">Partial fill</Badge>}
            {canEdit && (
              <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" aria-label="Edit fuel log" onClick={onEdit}>
                <Pencil className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-2.5 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Gauge className="h-3.5 w-3.5" />
            Odometer <span className="font-medium text-foreground tabular-nums">{log.odometerAtFill.toLocaleString()} km</span>
          </span>
          {log.kmSinceLastFill != null && (
            <span className="inline-flex items-center gap-1">
              <Route className="h-3.5 w-3.5" />
              <span className="font-medium text-foreground tabular-nums">{log.kmSinceLastFill.toLocaleString()} km</span> since last fill
            </span>
          )}
          {log.kmPerLiter != null && (
            <span>
              <span className="font-medium text-foreground tabular-nums">{fmtNum(log.kmPerLiter, 1)}</span> km/L
            </span>
          )}
          <span className="inline-flex items-center gap-1">
            <UserIcon className="h-3.5 w-3.5" />
            Recorded by <span className="font-medium text-foreground">{log.recordedBy.name}</span>
          </span>
          {log.dailySheet ? (
            <Link
              href={`/dashboard/daily-sheets/${log.dailySheet.id}`}
              className="inline-flex items-center gap-1 font-medium text-foreground hover:underline"
            >
              {log.dailySheet.van.plateNumber} · {fmtDate(log.dailySheet.date)}
              <ExternalLink className="h-3 w-3" />
            </Link>
          ) : (
            <span>Logged from Fleet page</span>
          )}
        </div>
        {log.notes && <p className="text-xs text-muted-foreground">Note: {log.notes}</p>}
      </CardContent>
    </Card>
  );
}

export function VehicleFuelTab({ vehicleId, period }: VehicleFuelTabProps) {
  const canRecord = useCan('fleet:record_fuel');
  const canEdit = useCan('fleet:update');
  const [formOpen, setFormOpen] = useState(false);
  const [editLog, setEditLog] = useState<FuelLogEntry | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [payment, setPayment] = useState<'all' | 'cash' | 'other'>('all');
  const [tank, setTank] = useState<'all' | 'full' | 'partial'>('all');
  const [station, setStation] = useState('');

  // Any filter/period change starts again from the first page.
  useEffect(() => setPage(1), [period.dateFrom, period.dateTo, payment, tank, station]);

  const { data, isLoading, isFetching } = useFuelLogs({
    vehicleId,
    page,
    limit: PAGE_SIZE,
    dateFrom: period.dateFrom,
    dateTo: period.dateTo,
    payment: payment === 'all' ? undefined : payment,
    tank: tank === 'all' ? undefined : tank,
    station: station.trim() || undefined,
  });
  const summary = data?.summary;
  const totalPages = data?.meta.totalPages ?? 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={payment} onValueChange={(v) => setPayment(v as typeof payment)}>
            <SelectTrigger className="h-10 w-40 rounded-xl"><SelectValue /></SelectTrigger>
            <SelectContent className="rounded-xl">
              <SelectItem value="all">All payments</SelectItem>
              <SelectItem value="cash">Van cash</SelectItem>
              <SelectItem value="other">Card / Bank</SelectItem>
            </SelectContent>
          </Select>
          <Select value={tank} onValueChange={(v) => setTank(v as typeof tank)}>
            <SelectTrigger className="h-10 w-36 rounded-xl"><SelectValue /></SelectTrigger>
            <SelectContent className="rounded-xl">
              <SelectItem value="all">Full + partial</SelectItem>
              <SelectItem value="full">Full tank</SelectItem>
              <SelectItem value="partial">Partial fill</SelectItem>
            </SelectContent>
          </Select>
          <Input
            placeholder="Search station…"
            value={station}
            onChange={(e) => setStation(e.target.value)}
            className="h-10 w-44 rounded-xl"
          />
        </div>
        {canRecord && (
          <Button onClick={() => { setEditLog(undefined); setFormOpen(true); }} className="rounded-xl font-bold gap-2">
            <Plus className="h-4 w-4" />
            Log Fuel Fill
          </Button>
        )}
      </div>

      {summary && (
        <div className="grid grid-cols-2 gap-3 rounded-2xl border border-border/60 bg-card p-4 sm:grid-cols-5">
          {[
            ['Fills', String(summary.fills)],
            ['Total fuel cost', fmtMoney(summary.totalCost)],
            ['Litres', `${fmtNum(summary.totalLiters, 1)} L`],
            ['Avg price', summary.avgPricePerLiter != null ? `₨${fmtNum(summary.avgPricePerLiter, 1)}/L` : '—'],
            ['Avg km/L', summary.avgKmPerLiter != null ? fmtNum(summary.avgKmPerLiter, 1) : '—'],
          ].map(([label, value]) => (
            <div key={label}>
              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">{label}</p>
              <p className="text-base font-bold tabular-nums">{value}</p>
            </div>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
        </div>
      ) : !data?.data.length ? (
        <Card className="rounded-2xl border-dashed">
          <CardContent className="p-8 text-center text-muted-foreground text-sm">
            No fuel fills match these filters.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {data.data.map((log) => (
            <FuelLogRow
              key={log.id}
              log={log}
              canEdit={canEdit}
              onEdit={() => { setEditLog(log); setFormOpen(true); }}
            />
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">Page {page} of {totalPages} · {data?.meta.total} fills</p>
          <div className="flex gap-1.5">
            <Button variant="outline" size="sm" className="rounded-xl gap-1" disabled={page <= 1 || isFetching} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft className="h-4 w-4" /> Newer
            </Button>
            <Button variant="outline" size="sm" className="rounded-xl gap-1" disabled={page >= totalPages || isFetching} onClick={() => setPage((p) => p + 1)}>
              Older <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      <FuelLogFormDialog
        vehicleId={vehicleId}
        open={formOpen}
        onOpenChange={(o) => { setFormOpen(o); if (!o) setEditLog(undefined); }}
        fuelLog={editLog}
      />
    </div>
  );
}
