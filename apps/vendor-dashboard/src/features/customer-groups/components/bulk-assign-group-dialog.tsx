'use client';

import { useState } from 'react';
import {
  Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@water-supply-crm/ui';
import { Loader2 } from 'lucide-react';
import { useBulkAssignGroup, useCustomerGroups } from '../hooks/use-customer-groups';

const NONE = '__none__';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerIds: string[];
  onSuccess?: () => void;
}

/** Put the selected customers in one group / sub-group, or take them out of any group. */
export function BulkAssignGroupDialog({ open, onOpenChange, customerIds, onSuccess }: Props) {
  const { data: groups } = useCustomerGroups(open);
  const { mutate: assign, isPending } = useBulkAssignGroup();
  const [groupId, setGroupId] = useState(NONE);
  const [subGroupId, setSubGroupId] = useState(NONE);

  const selected = groups?.find((g) => g.id === groupId);
  const count = customerIds.length;

  const close = (o: boolean) => {
    if (!o) {
      setGroupId(NONE);
      setSubGroupId(NONE);
    }
    onOpenChange(o);
  };

  const submit = () => {
    assign(
      {
        customerIds,
        groupId: groupId === NONE ? null : groupId,
        subGroupId: groupId !== NONE && subGroupId !== NONE ? subGroupId : null,
      },
      { onSuccess: () => { close(false); onSuccess?.(); } },
    );
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Assign group</DialogTitle>
          <DialogDescription>
            Applies to {count} selected customer{count === 1 ? '' : 's'}. Choose "No group" to clear it.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Select value={groupId} onValueChange={(v) => { setGroupId(v); setSubGroupId(NONE); }}>
            <SelectTrigger><SelectValue placeholder="No group" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>No group</SelectItem>
              {(groups ?? []).map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
            </SelectContent>
          </Select>
          {selected && selected.subGroups.length > 0 && (
            <Select value={subGroupId} onValueChange={setSubGroupId}>
              <SelectTrigger><SelectValue placeholder="No sub-group" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>No sub-group</SelectItem>
                {selected.subGroups.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)} disabled={isPending}>Cancel</Button>
          <Button onClick={submit} disabled={isPending || count === 0}>
            {isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            {groupId === NONE ? 'Clear group' : 'Assign'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
