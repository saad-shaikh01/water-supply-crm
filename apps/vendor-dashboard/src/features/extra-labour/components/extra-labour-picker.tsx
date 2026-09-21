import { useState } from 'react';
import {
  Button,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Badge,
} from '@water-supply-crm/ui';
import { UserPlus, Users } from 'lucide-react';
import { useExtraLabourOptions } from '../hooks/use-extra-labour';
import { ExtraLabourFormDialog } from './extra-labour-form-dialog';
import { ExtraLabourProfile } from '../api/extra-labour.api';

interface ExtraLabourPickerProps {
  value?: string | null;
  onChange: (value: string | null) => void;
  required?: boolean;
  disabled?: boolean;
  labourTypeId?: string;
  className?: string;
}

export function ExtraLabourPicker({
  value,
  onChange,
  required,
  disabled,
  labourTypeId,
  className,
}: ExtraLabourPickerProps) {
  const [isFormOpen, setIsFormOpen] = useState(false);
  const { data: options = [], isLoading } = useExtraLabourOptions(
    undefined,
    labourTypeId,
    true,
    true,
  );

  const selectedOption = options.find((o) => o.id === value);

  const handleCreated = (newLabourer: ExtraLabourProfile) => {
    onChange(newLabourer.id);
  };

  return (
    <div className={`space-y-1.5 ${className || ''}`}>
      <div className="flex items-center justify-between">
        <Label htmlFor="extra-labour-picker" className="text-xs font-medium text-foreground">
          Assigned Extra Labourer {required && <span className="text-destructive">*</span>}
        </Label>
        <button
          type="button"
          onClick={() => setIsFormOpen(true)}
          disabled={disabled}
          className="text-xs text-primary hover:underline font-medium flex items-center gap-1"
        >
          <UserPlus className="w-3 h-3" /> New Worker
        </button>
      </div>

      <Select
        value={value || ''}
        onValueChange={(val) => onChange(val || null)}
        disabled={disabled || isLoading}
      >
        <SelectTrigger id="extra-labour-picker" className="w-full">
          <SelectValue
            placeholder={
              isLoading
                ? 'Loading workers...'
                : options.length === 0
                ? 'No workers registered — click New Worker'
                : 'Select extra labourer'
            }
          />
        </SelectTrigger>
        <SelectContent className="max-h-60">
          {options.map((opt) => (
            <SelectItem key={opt.id} value={opt.id}>
              <div className="flex items-center justify-between gap-3 w-full">
                <span className="font-medium text-sm text-foreground">{opt.name}</span>
                <div className="flex items-center gap-2">
                  {opt.phone && (
                    <span className="text-xs text-muted-foreground">{opt.phone}</span>
                  )}
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-normal">
                    {opt.labourTypeName}
                  </Badge>
                </div>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {selectedOption && (
        <p className="text-[11px] text-muted-foreground flex items-center gap-1 pt-0.5">
          <Users className="w-3 h-3 text-primary" />
          <span>{selectedOption.name}</span>
          <span className="font-semibold">• {selectedOption.labourTypeName}</span>
          {selectedOption.phone && <span>({selectedOption.phone})</span>}
        </p>
      )}

      {isFormOpen && (
        <ExtraLabourFormDialog
          open={isFormOpen}
          onOpenChange={setIsFormOpen}
          onSuccess={handleCreated}
        />
      )}
    </div>
  );
}
