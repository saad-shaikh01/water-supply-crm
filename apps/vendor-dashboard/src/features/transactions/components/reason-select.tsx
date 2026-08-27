'use client';

import {
  Label, Textarea,
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@water-supply-crm/ui';
import { PAYMENT_EDIT_REASONS } from '../schemas';

/** Enum key → human label, shared by the edit + delete payment forms. */
export const REASON_OPTIONS: Record<(typeof PAYMENT_EDIT_REASONS)[number], string> = {
  WRONG_AMOUNT: 'Wrong amount entered',
  CASH_RECOUNTED: 'Cash recounted',
  DUPLICATE_ENTRY: 'Duplicate entry correction',
  WRONG_CUSTOMER: 'Recorded on wrong customer',
  CUSTOMER_REQUESTED: 'Customer requested correction',
  OTHER: 'Other',
};

type ReasonKey = (typeof PAYMENT_EDIT_REASONS)[number];

interface ReasonSelectProps {
  value: ReasonKey | undefined;
  onChange: (value: ReasonKey) => void;
  /** Current `reasonNote` value — the note field only renders when reason is OTHER. */
  note: string;
  onNoteChange: (value: string) => void;
  reasonError?: string;
  noteError?: string;
  disabled?: boolean;
}

/**
 * Shared correction-reason control: a required Select over the six reason keys,
 * plus a conditional note Textarea that appears (and is required) only for OTHER.
 */
export function ReasonSelect({
  value,
  onChange,
  note,
  onNoteChange,
  reasonError,
  noteError,
  disabled,
}: ReasonSelectProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label className="text-sm font-semibold">Reason for correction</Label>
        <Select
          value={value}
          onValueChange={(v) => onChange(v as ReasonKey)}
          disabled={disabled}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select a reason…" />
          </SelectTrigger>
          <SelectContent>
            {PAYMENT_EDIT_REASONS.map((key) => (
              <SelectItem key={key} value={key}>
                {REASON_OPTIONS[key]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {reasonError && <p className="text-xs font-medium text-destructive">{reasonError}</p>}
      </div>

      {value === 'OTHER' && (
        <div className="space-y-2">
          <Label className="text-sm font-semibold">Note</Label>
          <Textarea
            placeholder="Briefly describe what went wrong…"
            value={note}
            onChange={(e) => onNoteChange(e.target.value)}
            disabled={disabled}
            rows={3}
          />
          {noteError && <p className="text-xs font-medium text-destructive">{noteError}</p>}
        </div>
      )}
    </div>
  );
}
