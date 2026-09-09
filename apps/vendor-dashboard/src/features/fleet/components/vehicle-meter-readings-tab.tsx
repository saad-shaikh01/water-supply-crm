'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Gauge,
  ArrowRight,
  User as UserIcon,
  AlertTriangle,
  Pencil,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { Card, CardContent, Badge, Button, Skeleton } from '@water-supply-crm/ui';
import type { VehicleCheckHistoryEntry, VehicleDailyCheckEntry } from '@water-supply-crm/types';
import { useVehicleCheckHistory } from '../hooks/use-vehicle-checks';

interface VehicleMeterReadingsTabProps {
  vehicleId: string;
}

const PAGE_SIZE = 20;

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-PK', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-PK', { hour: 'numeric', minute: '2-digit' });
}

function failedItems(check: VehicleDailyCheckEntry) {
  return (check.checklistResults ?? []).filter((r) => !r.passed);
}

/** One START or END reading, rendered as a labelled row inside a day card. */
function CheckRow({ label, check }: { label: 'Start' | 'End'; check: VehicleDailyCheckEntry | null }) {
  if (!check) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="w-12 shrink-0 text-xs font-bold uppercase text-muted-foreground">{label}</span>
        <span className="text-muted-foreground">Not recorded</span>
      </div>
    );
  }

  const corrected = check.originalOdometerReading != null;
  const fails = failedItems(check);

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="w-12 shrink-0 text-xs font-bold uppercase text-muted-foreground">{label}</span>
        <span className="font-semibold tabular-nums">{check.odometerReading.toLocaleString()} km</span>
        <span className="text-xs text-muted-foreground">· {fmtTime(check.recordedAt)}</span>
        <span className="text-xs text-muted-foreground">· by {check.recordedBy.name}</span>
        {check.fuelGaugeLevel != null && (
          <Badge variant="outline" className="text-[11px]">
            Fuel {check.fuelGaugeLevel}/8
          </Badge>
        )}
        {corrected && (
          <Badge
            variant="outline"
            className="gap-1 text-[11px] bg-blue-500/10 text-blue-600 border-blue-500/30"
            title={`Originally ${check.originalOdometerReading?.toLocaleString()} km${
              check.odometerEditReason ? ` — ${check.odometerEditReason}` : ''
            }${check.odometerEditedBy ? ` (${check.odometerEditedBy.name})` : ''}`}
          >
            <Pencil className="h-3 w-3" />
            Corrected
          </Badge>
        )}
        {check.odometerContinuityFlag && (
          <Badge
            variant="outline"
            className="gap-1 text-[11px] bg-amber-500/10 text-amber-600 border-amber-500/30"
            title={check.continuityNote ?? undefined}
          >
            <AlertTriangle className="h-3 w-3" />
            Large jump
          </Badge>
        )}
        {check.hasCriticalFailure && !check.criticalOverrideById && (
          <Badge variant="outline" className="gap-1 text-[11px] bg-destructive/10 text-destructive border-destructive/30">
            <AlertTriangle className="h-3 w-3" />
            Critical issue
          </Badge>
        )}
      </div>

      {fails.length > 0 && (
        <p className="pl-14 text-xs text-destructive">
          Failed: {fails.map((f) => f.label).join(', ')}
        </p>
      )}
      {check.damageNoted && (
        <p className="pl-14 text-xs text-amber-600">
          Damage noted{check.damageNote ? `: ${check.damageNote}` : ''}
        </p>
      )}
      {check.note && <p className="pl-14 text-xs text-muted-foreground">Note: {check.note}</p>}
    </div>
  );
}

function DayCard({ entry }: { entry: VehicleCheckHistoryEntry }) {
  return (
    <Card className="rounded-2xl">
      <CardContent className="p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Gauge className="h-4 w-4 text-primary shrink-0" />
            <span className="font-bold text-sm">{fmtDate(entry.date)}</span>
            {entry.sheetKind === 'WALK_IN' && (
              <Badge variant="outline" className="text-[11px]">Walk-in</Badge>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {entry.distanceKm != null && (
              <Badge className="text-[11px] border-none bg-primary/10 text-primary gap-1">
                <ArrowRight className="h-3 w-3" />
                {entry.distanceKm.toLocaleString()} km
              </Badge>
            )}
            <Link
              href={`/dashboard/daily-sheets/${entry.dailySheetId}`}
              className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              {entry.van.plateNumber}
              <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
        </div>

        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <UserIcon className="h-3.5 w-3.5 shrink-0" />
          Driver: <span className="font-medium text-foreground">{entry.driver.name}</span>
        </div>

        <div className="space-y-2 border-t pt-3">
          <CheckRow label="Start" check={entry.start} />
          <CheckRow label="End" check={entry.end} />
        </div>
      </CardContent>
    </Card>
  );
}

export function VehicleMeterReadingsTab({ vehicleId }: VehicleMeterReadingsTabProps) {
  const [page, setPage] = useState(1);
  const { data, isLoading, isFetching } = useVehicleCheckHistory(vehicleId, { page, limit: PAGE_SIZE });

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-2xl" />
        ))}
      </div>
    );
  }

  const rows = data?.data ?? [];
  const totalPages = data?.meta.totalPages ?? 1;

  if (rows.length === 0) {
    return (
      <Card className="rounded-2xl border-dashed">
        <CardContent className="p-8 text-center text-muted-foreground text-sm">
          No meter readings recorded for this vehicle yet. Readings are captured on each daily
          sheet&apos;s start- and end-of-day vehicle check.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {rows.map((entry) => (
          <DayCard key={entry.dailySheetId} entry={entry} />
        ))}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Page {page} of {totalPages} · {data?.meta.total} days
          </p>
          <div className="flex gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="rounded-xl gap-1"
              disabled={page <= 1 || isFetching}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft className="h-4 w-4" />
              Newer
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="rounded-xl gap-1"
              disabled={page >= totalPages || isFetching}
              onClick={() => setPage((p) => p + 1)}
            >
              Older
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
