'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button, Card, CardContent, Input, cn } from '@water-supply-crm/ui';
import type { FileVan } from '../api/data-import.api';
import { importErrorOf, useRemapVan } from '../hooks/use-data-import';

const NEW_VAN = '__new__';

const STATUS: Record<FileVan['status'], { label: string; className: string }> = {
  EXISTING: { label: 'Existing van', className: 'bg-emerald-500/10 text-emerald-600' },
  NEW: { label: 'Will be created', className: 'bg-primary/10 text-primary' },
  INACTIVE: { label: 'Inactive', className: 'bg-destructive/10 text-destructive' },
  NOT_FOUND: { label: 'Not found', className: 'bg-destructive/10 text-destructive' },
  INVALID: { label: 'Invalid name', className: 'bg-destructive/10 text-destructive' },
};

const isProblem = (v: FileVan) => v.status !== 'EXISTING' && v.status !== 'NEW';

interface PickerProps {
  batchId: string;
  van: FileVan;
  availableVans: string[];
  onDone?: () => void;
}

/** Swap one file van for an existing van, or name a new one. The preview is rebuilt afterwards. */
export function VanPicker({ batchId, van, availableVans, onDone }: PickerProps) {
  const remap = useRemapVan(batchId);
  const [choice, setChoice] = useState('');
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const target = choice === NEW_VAN ? newName.trim() : choice;

  const apply = async (value: string | null) => {
    setError(null);
    try {
      await remap.mutateAsync({ label: van.label, van: value });
      setChoice('');
      setNewName('');
      onDone?.();
    } catch (e) {
      setError(importErrorOf(e, 'Could not change the van.').message);
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="h-9 w-full sm:w-56 rounded-full border bg-background px-3 text-sm text-foreground"
          value={choice} onChange={(e) => setChoice(e.target.value)} aria-label={`Van to use instead of ${van.label}`}
        >
          <option value="">Select a van…</option>
          <option value={NEW_VAN}>+ Create a new van</option>
          {availableVans.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
        {choice === NEW_VAN && (
          <Input className="h-9 w-full sm:w-48 rounded-full text-foreground" placeholder="New van name" maxLength={30} value={newName} onChange={(e) => setNewName(e.target.value)} />
        )}
        <Button size="sm" className="rounded-full" disabled={!target || remap.isPending} onClick={() => apply(target)}>
          {remap.isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}Apply
        </Button>
        {van.changed && (
          <Button size="sm" variant="ghost" className="rounded-full" disabled={remap.isPending} onClick={() => apply(null)}>Use the file&rsquo;s van</Button>
        )}
      </div>
      {error && <p className="text-xs text-destructive font-medium">{error}</p>}
    </div>
  );
}

/** Every van named in the file, problems first, each replaceable. */
export function VansPanel({ batchId, vans, availableVans }: { batchId: string; vans: FileVan[]; availableVans: string[] }) {
  const sorted = [...vans].sort((a, b) => Number(isProblem(b)) - Number(isProblem(a)));
  const problems = vans.filter(isProblem).length;
  return (
    <Card className={cn('rounded-3xl', problems > 0 && 'border-destructive/40')}>
      <CardContent className="p-4 sm:p-6 space-y-3">
        <div>
          <p className="font-semibold">Vans in this file</p>
          <p className="text-xs text-muted-foreground">
            {problems > 0 && <span className="text-destructive font-medium">{problems} van(s) need your attention. </span>}
            Pick one of your vans or create a new one. A change applies to every row using that van; new vans are created only when you press Import.
          </p>
        </div>
        <ul className="divide-y rounded-xl border max-h-96 overflow-y-auto">
          {sorted.map((v) => (
            <li key={v.label} className="flex flex-wrap items-center justify-between gap-3 p-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{v.label}</span>
                {v.van !== v.label && <span className="text-muted-foreground">→ {v.van}</span>}
                <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', STATUS[v.status].className)}>{STATUS[v.status].label}</span>
                <span className="text-xs text-muted-foreground">{v.rows.toLocaleString()} row(s)</span>
              </div>
              <VanPicker batchId={batchId} van={v} availableVans={availableVans} />
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
