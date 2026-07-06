'use client';

import {
  Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@water-supply-crm/ui';
import { Users } from 'lucide-react';
import { useCrewCandidates } from '../../features/users/hooks/use-users';

export interface CrewSelection {
  salesmanId: string | null;
  loader1Id: string | null;
  loader2Id: string | null;
}

export const emptyCrewSelection: CrewSelection = {
  salesmanId: null,
  loader1Id: null,
  loader2Id: null,
};

/** Converts the editor selection to the API's crew array (full-replace). */
export function crewSelectionToArray(sel: CrewSelection) {
  const crew: Array<{ userId: string; role: 'SALESMAN' | 'LOADER' }> = [];
  if (sel.salesmanId) crew.push({ userId: sel.salesmanId, role: 'SALESMAN' });
  if (sel.loader1Id) crew.push({ userId: sel.loader1Id, role: 'LOADER' });
  if (sel.loader2Id && sel.loader2Id !== sel.loader1Id) crew.push({ userId: sel.loader2Id, role: 'LOADER' });
  return crew;
}

/** Builds an editor selection from a sheet/van crew array returned by the API. */
export function crewArrayToSelection(
  crew?: Array<{ userId: string; role: string }> | null,
): CrewSelection {
  const salesman = crew?.find((c) => c.role === 'SALESMAN');
  const loaders = crew?.filter((c) => c.role === 'LOADER') ?? [];
  return {
    salesmanId: salesman?.userId ?? null,
    loader1Id: loaders[0]?.userId ?? null,
    loader2Id: loaders[1]?.userId ?? null,
  };
}

// User roles eligible per crew slot (spare drivers/salesmen may ride along)
const SALESMAN_ELIGIBLE = ['SALESMAN', 'DRIVER'];
const LOADER_ELIGIBLE = ['LOADER', 'SALESMAN', 'DRIVER'];

interface CrewEditorProps {
  value: CrewSelection;
  onChange: (value: CrewSelection) => void;
  /** The assigned driver — excluded from every crew slot. */
  excludeUserId?: string | null;
}

const NONE = 'none';

export function CrewEditor({ value, onChange, excludeUserId }: CrewEditorProps) {
  const { data } = useCrewCandidates();
  const users = (data?.data ?? []) as Array<{ id: string; name: string; role: string }>;

  const optionsFor = (eligibleRoles: string[], selfValue: string | null) =>
    users.filter(
      (u) =>
        eligibleRoles.includes(u.role) &&
        u.id !== excludeUserId &&
        // hide people already picked in another slot (but keep this slot's own pick)
        (u.id === selfValue ||
          ![value.salesmanId, value.loader1Id, value.loader2Id].includes(u.id)),
    );

  const slot = (
    label: string,
    key: keyof CrewSelection,
    slotRole: string,
    eligibleRoles: string[],
    noneLabel: string,
  ) => (
    <div className="space-y-1.5">
      <Label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{label}</Label>
      <Select
        value={value[key] ?? NONE}
        onValueChange={(v) => onChange({ ...value, [key]: v === NONE ? null : v })}
      >
        <SelectTrigger className="h-10">
          <SelectValue placeholder={noneLabel} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>{noneLabel}</SelectItem>
          {optionsFor(eligibleRoles, value[key]).map((u) => (
            <SelectItem key={u.id} value={u.id}>
              {u.name}
              {u.role !== slotRole && (
                <span className="text-muted-foreground text-xs ml-1">({u.role.toLowerCase()})</span>
              )}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
        <Users className="h-3.5 w-3.5" />
        Supporting Crew
      </div>
      {slot('Salesman', 'salesmanId', 'SALESMAN', SALESMAN_ELIGIBLE, 'No salesman')}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {slot('Loader 1', 'loader1Id', 'LOADER', LOADER_ELIGIBLE, 'No loader')}
        {slot('Loader 2', 'loader2Id', 'LOADER', LOADER_ELIGIBLE, 'No second loader')}
      </div>
    </div>
  );
}
