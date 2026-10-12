'use client';

import { parseAsString, useQueryState } from 'nuqs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@water-supply-crm/ui';
import { useCustomerGroups } from '../hooks/use-customer-groups';

const UNGROUPED = '__none__';

interface GroupFiltersProps {
  onBeforeChange?: () => void;
}

/**
 * Group + Sub-group filter for the customer list. URL state: `groupId` (or the literal `none` for
 * "No group") and `subGroupId`. The sub-group picker only appears once a real group is chosen.
 */
export function GroupFilters({ onBeforeChange }: GroupFiltersProps) {
  const [groupId, setGroupId] = useQueryState('groupId', parseAsString.withDefault(''));
  const [subGroupId, setSubGroupId] = useQueryState('subGroupId', parseAsString.withDefault(''));
  // includeDeleted: voided groups stay pickable here so history can still be filtered by them.
  const { data: groups } = useCustomerGroups(true, true);

  const selected = groups?.find((g) => g.id === groupId);

  const onGroup = (v: string) => {
    onBeforeChange?.();
    setSubGroupId(null);
    setGroupId(v === 'all' ? null : v === UNGROUPED ? 'none' : v);
  };

  const onSub = (v: string) => {
    onBeforeChange?.();
    setSubGroupId(v === 'all' ? null : v);
  };

  return (
    <>
      <div className="space-y-2">
        <Select value={groupId === 'none' ? UNGROUPED : groupId || 'all'} onValueChange={onGroup}>
          <SelectTrigger className="rounded-xl bg-background/50 border-border h-10">
            <SelectValue placeholder="All Groups" />
          </SelectTrigger>
          <SelectContent className="rounded-xl border-border shadow-2xl">
            <SelectItem value="all">All Groups</SelectItem>
            <SelectItem value={UNGROUPED}>No group</SelectItem>
            {(groups ?? []).map((g) => (
              <SelectItem key={g.id} value={g.id}>{g.name}{g.deletedAt ? ' (deleted)' : ''}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {selected && selected.subGroups.length > 0 && (
        <div className="space-y-2">
          <Select value={subGroupId || 'all'} onValueChange={onSub}>
            <SelectTrigger className="rounded-xl bg-background/50 border-border h-10">
              <SelectValue placeholder="All Sub-groups" />
            </SelectTrigger>
            <SelectContent className="rounded-xl border-border shadow-2xl">
              <SelectItem value="all">All Sub-groups</SelectItem>
              {selected.subGroups.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.name}{s.deletedAt ? ' (deleted)' : ''}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </>
  );
}
