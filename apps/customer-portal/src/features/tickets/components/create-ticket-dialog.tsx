'use client';

import { useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  Button, Label, Input,
} from '@water-supply-crm/ui';
import { Loader2, MessageCircle, AlertTriangle, ThumbsUp } from 'lucide-react';
import { cn } from '@water-supply-crm/ui';
import { useCreateTicket } from '../hooks/use-tickets';

const PRIORITIES = [
  { value: 'LOW',    label: 'Low' },
  { value: 'NORMAL', label: 'Normal' },
  { value: 'HIGH',   label: 'High' },
  { value: 'URGENT', label: 'Urgent' },
];

interface CreateTicketDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateTicketDialog({ open, onOpenChange }: CreateTicketDialogProps) {
  const { mutate: createTicket, isPending } = useCreateTicket();

  const [type, setType] = useState<'COMPLAINT' | 'FEEDBACK'>('COMPLAINT');
  const [priority, setPriority] = useState('NORMAL');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');

  const reset = () => {
    setType('COMPLAINT');
    setPriority('NORMAL');
    setSubject('');
    setDescription('');
  };

  const isValid = subject.trim().length >= 3 && description.trim().length >= 10;

  const handleSubmit = () => {
    if (!isValid) return;
    createTicket(
      { type, subject: subject.trim(), description: description.trim(), priority },
      { onSuccess: () => { onOpenChange(false); reset(); } },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="sm:max-w-md rounded-3xl border-border/50 bg-card/90 backdrop-blur-xl">
        <DialogHeader>
          <DialogTitle className="font-black tracking-tight flex items-center gap-2">
            <MessageCircle className="h-5 w-5 text-primary" />
            New Support Ticket
          </DialogTitle>
          <DialogDescription className="text-[11px] text-muted-foreground uppercase tracking-widest font-bold">
            We'll get back to you as soon as possible
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {/* Type toggle */}
          <div className="space-y-1.5">
            <Label className="text-xs font-bold uppercase tracking-wider">Type</Label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setType('COMPLAINT')}
                className={cn(
                  'flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold border transition-all',
                  type === 'COMPLAINT'
                    ? 'bg-destructive/10 text-destructive border-destructive/20'
                    : 'border-border text-muted-foreground hover:border-primary/30 hover:text-foreground',
                )}
              >
                <AlertTriangle className="h-3.5 w-3.5" />
                Complaint
              </button>
              <button
                type="button"
                onClick={() => setType('FEEDBACK')}
                className={cn(
                  'flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold border transition-all',
                  type === 'FEEDBACK'
                    ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'
                    : 'border-border text-muted-foreground hover:border-primary/30 hover:text-foreground',
                )}
              >
                <ThumbsUp className="h-3.5 w-3.5" />
                Feedback
              </button>
            </div>
          </div>

          {/* Priority */}
          <div className="space-y-1.5">
            <Label className="text-xs font-bold uppercase tracking-wider">Priority</Label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              {PRIORITIES.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </div>

          {/* Subject */}
          <div className="space-y-1.5">
            <Label className="text-xs font-bold uppercase tracking-wider">Subject</Label>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Brief summary of your issue..."
              className="rounded-xl"
            />
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label className="text-xs font-bold uppercase tracking-wider">Description</Label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Please describe your issue in detail (minimum 10 characters)..."
              rows={4}
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            {description.length > 0 && description.length < 10 && (
              <p className="text-[11px] text-destructive">At least 10 characters required</p>
            )}
          </div>

          <Button
            onClick={handleSubmit}
            disabled={!isValid || isPending}
            className="w-full rounded-2xl font-bold gap-2 shadow-lg shadow-primary/20"
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}
            Submit Ticket
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
