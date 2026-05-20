'use client';

import { useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button, Input, Label,
} from '@water-supply-crm/ui';
import { Globe, Mail, Lock } from 'lucide-react';
import { useCreatePortalAccount } from '../../hooks/use-customers';

interface PortalAccountDialogProps {
  open: boolean;
  onClose: () => void;
  customerId: string;
}

export function PortalAccountDialog({ open, onClose, customerId }: PortalAccountDialogProps) {
  const { mutate: createAccount, isPending } = useCreatePortalAccount();
  const [form, setForm] = useState({ email: '', password: '' });

  const handleClose = () => {
    setForm({ email: '', password: '' });
    onClose();
  };

  const handleSubmit = () => {
    createAccount({ id: customerId, data: form }, { onSuccess: handleClose });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="rounded-3xl max-w-sm bg-background/95 backdrop-blur-xl border-border/50">
        <DialogHeader>
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <Globe className="h-6 w-6 text-primary" />
            Portal Setup
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground">Login Email</Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="email"
                placeholder="customer@email.com"
                className="pl-9 h-11"
                value={form.email}
                onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground">Initial Password</Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="password"
                placeholder="••••••••"
                className="pl-9 h-11"
                value={form.password}
                onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))}
              />
            </div>
            <p className="text-[10px] text-muted-foreground font-medium">Minimum 8 characters recommended.</p>
          </div>
        </div>
        <DialogFooter className="gap-3 sm:gap-0 border-t pt-6 mt-2">
          <Button variant="ghost" onClick={handleClose} className="rounded-xl">Cancel</Button>
          <Button
            onClick={handleSubmit}
            disabled={isPending || !form.email || !form.password}
            className="rounded-xl font-bold shadow-lg shadow-primary/20"
          >
            {isPending ? 'Setting up...' : 'Enable Access'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
