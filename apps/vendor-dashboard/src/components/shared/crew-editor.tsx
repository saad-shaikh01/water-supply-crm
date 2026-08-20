'use client';

import {
  Badge, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@water-supply-crm/ui';
import { Users, X } from 'lucide-react';
import { useCrewCandidates } from '../../features/users/hooks/use-users';

export interface CrewSelection {
  salesmanIds: string[];
  loaderIds: string[];
}

export const emptyCrewSelection: CrewSelection = {
  salesmanIds: [],
  loaderIds: [],
};

/** Converts the editor selection to the API's crew array (full-replace). */
export function crewSelectionToArray(sel: CrewSelection) {
  const crew: Array<{ userId: string; role: 'SALESMAN' | 'LOADER' }> = [];
  sel.salesmanIds.forEach((userId) => crew.push({ userId, role: 'SALESMAN' }));
  sel.loaderIds.forEach((userId) => crew.push({ userId, role: 'LOADER' }));
  return crew;
}

/** Builds an editor selection from a sheet/van crew array returned by the API. */
export function crewArrayToSelection(
  crew?: Array<{ userId: string; role: string }> | null,
): CrewSelection {
  return {
    salesmanIds: crew?.filter((c) => c.role === 'SALESMAN').map((c) => c.userId) ?? [],
    loaderIds: crew?.filter((c) => c.role === 'LOADER').map((c) => c.userId) ?? [],
  };
}

// Which home UserRole may fill each day's crew slot. DRIVER/SALESMAN/LOADER
// are treated as one interchangeable field-staff pool — the same person can
// drive today and load tomorrow, so every slot (including the Driver picker
// in van-form.tsx/swap-dialog.tsx, which reuses this map) accepts all three.
// Mirrors the backend's ALLOWED_USER_ROLES in crew-validation.ts — keep both
// in sync.
export const CREW_ROLE_ELIGIBLE: Record<'DRIVER' | 'SALESMAN' | 'LOADER', string[]> = {
  DRIVER: ['DRIVER', 'SALESMAN', 'LOADER'],
  SALESMAN: ['SALESMAN', 'DRIVER', 'LOADER'],
  LOADER: ['LOADER', 'SALESMAN', 'DRIVER'],
};
const SALESMAN_ELIGIBLE = CREW_ROLE_ELIGIBLE.SALESMAN;
const LOADER_ELIGIBLE = CREW_ROLE_ELIGIBLE.LOADER;

// Controlled Select value that never matches a real option, so the trigger
// always shows its placeholder — picking an item just appends to the list.
const ADD = '__add__';

interface CrewEditorProps {
  value: CrewSelection;
  onChange: (value: CrewSelection) => void;
  /** The assigned driver — excluded from every crew slot. */
  excludeUserId?: string | null;
}

export function CrewEditor({ value, onChange, excludeUserId }: CrewEditorProps) {
  const { data } = useCrewCandidates();
  const users = (data?.data ?? []) as Array<{ id: string; name: string; role: string }>;
  const usersById = new Map(users.map((u) => [u.id, u]));
  const picked = new Set([...value.salesmanIds, ...value.loaderIds]);

  const group = (
    label: string,
    key: keyof CrewSelection,
    slotRole: string,
    eligibleRoles: string[],
    addLabel: string,
    emptyLabel: string,
  ) => {
    const ids = value[key];
    const options = users.filter(
      (u) => eligibleRoles.includes(u.role) && u.id !== excludeUserId && !picked.has(u.id),
    );
    const add = (userId: string) => onChange({ ...value, [key]: [...ids, userId] });
    const remove = (userId: string) => onChange({ ...value, [key]: ids.filter((id) => id !== userId) });

    return (
      <div className="space-y-1.5">
        <Label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{label}</Label>

        {ids.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {ids.map((id) => {
              const u = usersById.get(id);
              return (
                <Badge key={id} variant="secondary" className="normal-case gap-1 pr-1 text-xs font-semibold">
                  {u?.name ?? 'Unknown'}
                  {u && u.role !== slotRole && (
                    <span className="lowercase text-muted-foreground/70">({u.role.toLowerCase()})</span>
                  )}
                  <button
                    type="button"
                    onClick={() => remove(id)}
                    className="ml-0.5 rounded-full p-0.5 hover:bg-background/60"
                    aria-label={`Remove ${u?.name ?? 'member'}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              );
            })}
          </div>
        )}

        {options.length > 0 ? (
          <Select value={ADD} onValueChange={add}>
            <SelectTrigger className="h-9 text-xs">
              <SelectValue placeholder={addLabel} />
            </SelectTrigger>
            <SelectContent>
              {options.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.name}
                  {u.role !== slotRole && (
                    <span className="ml-1 text-xs text-muted-foreground">({u.role.toLowerCase()})</span>
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : ids.length === 0 ? (
          <p className="text-xs italic text-muted-foreground">{emptyLabel}</p>
        ) : null}
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
        <Users className="h-3.5 w-3.5" />
        Supporting Crew
      </div>
      {group('Salesmen', 'salesmanIds', 'SALESMAN', SALESMAN_ELIGIBLE, 'Add salesman', 'No salesmen assigned')}
      {group('Loaders', 'loaderIds', 'LOADER', LOADER_ELIGIBLE, 'Add loader', 'No loaders assigned')}
    </div>
  );
}
