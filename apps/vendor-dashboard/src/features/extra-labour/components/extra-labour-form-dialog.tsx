import { useEffect, useState } from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Textarea,
  Switch,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@water-supply-crm/ui';
import { AlertTriangle, Loader2, UserPlus, Users } from 'lucide-react';
import {
  useCreateExtraLabour,
  useExtraLabourTypes,
  useUpdateExtraLabour,
} from '../hooks/use-extra-labour';
import { ExtraLabourListItem, ExtraLabourProfile } from '../api/extra-labour.api';

interface ExtraLabourFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  labourer?: ExtraLabourListItem | ExtraLabourProfile | null;
  onSuccess?: (createdOrUpdated: ExtraLabourProfile) => void;
  onManageTypesClick?: () => void;
}

export function ExtraLabourFormDialog({
  open,
  onOpenChange,
  labourer,
  onSuccess,
  onManageTypesClick,
}: ExtraLabourFormDialogProps) {
  const isEditing = !!labourer;
  const { data: types = [], isLoading: loadingTypes } = useExtraLabourTypes(true);
  const createMutation = useCreateExtraLabour();
  const updateMutation = useUpdateExtraLabour();

  const [name, setName] = useState('');
  const [labourTypeId, setLabourTypeId] = useState('');
  const [phone, setPhone] = useState('');
  const [cnic, setCnic] = useState('');
  const [notes, setNotes] = useState('');
  const [isActive, setIsActive] = useState(true);

  const [warnings, setWarnings] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (labourer) {
      setName(labourer.name || '');
      setLabourTypeId(labourer.labourTypeId || '');
      setPhone(labourer.phone || '');
      setCnic(labourer.cnic || '');
      setNotes(labourer.notes || '');
      setIsActive(labourer.isActive ?? true);
    } else {
      setName('');
      setLabourTypeId('');
      setPhone('');
      setCnic('');
      setNotes('');
      setIsActive(true);
    }
    setWarnings([]);
    setErrorMsg(null);
  }, [labourer, open]);

  // Default selection to first active type if none selected
  useEffect(() => {
    if (!labourTypeId && types.length > 0) {
      const activeFirst = types.find((t) => t.isActive) || types[0];
      if (activeFirst) setLabourTypeId(activeFirst.id);
    }
  }, [types, labourTypeId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !labourTypeId) return;

    setErrorMsg(null);
    setWarnings([]);

    try {
      if (isEditing && labourer) {
        const res = await updateMutation.mutateAsync({
          id: labourer.id,
          data: {
            name: name.trim(),
            labourTypeId,
            phone: phone.trim() || null,
            cnic: cnic.trim() || null,
            notes: notes.trim() || null,
            isActive,
          },
        });
        if (res.warnings && res.warnings.length > 0) {
          setWarnings(res.warnings);
        }
        if (onSuccess && res.data) {
          onSuccess(res.data);
        }
        if (!res.warnings || res.warnings.length === 0) {
          onOpenChange(false);
        }
      } else {
        const res = await createMutation.mutateAsync({
          name: name.trim(),
          labourTypeId,
          phone: phone.trim() || null,
          cnic: cnic.trim() || null,
          notes: notes.trim() || null,
          isActive,
        });
        if (res.warnings && res.warnings.length > 0) {
          setWarnings(res.warnings);
        }
        if (onSuccess && res.data) {
          onSuccess(res.data);
        }
        if (!res.warnings || res.warnings.length === 0) {
          onOpenChange(false);
        }
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setErrorMsg(msg || 'An error occurred while saving.');
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {isEditing ? <Users className="w-5 h-5 text-primary" /> : <UserPlus className="w-5 h-5 text-primary" />}
              {isEditing ? 'Edit Extra Labourer' : 'Add Extra Labourer'}
            </DialogTitle>
            <DialogDescription>
              {isEditing
                ? 'Update worker contact information or role details.'
                : 'Register a daily wage or temporary worker to track payouts.'}
            </DialogDescription>
          </DialogHeader>

          {errorMsg && (
            <div className="mt-3 p-3 text-sm text-destructive bg-destructive/10 rounded-md border border-destructive/20">
              {errorMsg}
            </div>
          )}

          {warnings.length > 0 && (
            <div className="mt-3 p-3 text-sm text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/40 rounded-md border border-amber-200 dark:border-amber-900/50 space-y-1">
              <div className="flex items-center gap-1.5 font-semibold">
                <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                <span>Notice</span>
              </div>
              {warnings.map((w, idx) => (
                <p key={idx} className="text-xs">
                  {w}
                </p>
              ))}
            </div>
          )}

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="labour-name">Worker Name *</Label>
              <Input
                id="labour-name"
                placeholder="e.g. Ali Raza"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="labour-type">Labour Category *</Label>
                {onManageTypesClick && (
                  <button
                    type="button"
                    onClick={onManageTypesClick}
                    className="text-xs text-primary hover:underline font-medium"
                  >
                    + Manage Categories
                  </button>
                )}
              </div>
              <Select value={labourTypeId} onValueChange={setLabourTypeId}>
                <SelectTrigger id="labour-type">
                  <SelectValue placeholder={loadingTypes ? 'Loading types...' : 'Select job role'} />
                </SelectTrigger>
                <SelectContent>
                  {types.map((t) => (
                    <SelectItem key={t.id} value={t.id} disabled={!t.isActive && t.id !== labourTypeId}>
                      {t.name} {!t.isActive ? '(Inactive)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="labour-phone">Phone Number (Optional)</Label>
                <Input
                  id="labour-phone"
                  placeholder="e.g. 03001234567"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="labour-cnic">CNIC (Optional)</Label>
                <Input
                  id="labour-cnic"
                  placeholder="e.g. 35201-1234567-1"
                  value={cnic}
                  onChange={(e) => setCnic(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="labour-notes">Notes / Qualifications (Optional)</Label>
              <Textarea
                id="labour-notes"
                placeholder="e.g. Reliable helper, works on Sunday shifts"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
              />
            </div>

            <div className="flex items-center justify-between p-3 bg-muted/40 rounded-lg border">
              <div className="space-y-0.5">
                <Label htmlFor="active-status" className="cursor-pointer font-medium text-sm">
                  Active Status
                </Label>
                <p className="text-xs text-muted-foreground">
                  Inactive workers will be hidden from payout dropdowns
                </p>
              </div>
              <Switch id="active-status" checked={isActive} onCheckedChange={setIsActive} />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || !labourTypeId || isPending}>
              {isPending && <Loader2 className="w-4 h-4 animate-spin mr-1.5" />}
              {isEditing ? 'Update Worker' : 'Add Worker'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
