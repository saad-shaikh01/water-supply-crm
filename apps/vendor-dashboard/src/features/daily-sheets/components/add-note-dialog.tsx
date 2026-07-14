'use client';

import { useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button, Textarea,
} from '@water-supply-crm/ui';
import { Mic, FileText, Loader2 } from 'lucide-react';
import { cn } from '@water-supply-crm/ui';
import { VoiceRecorder } from '../../../components/shared/voice-recorder';
import { useAddTextNote, useAddVoiceNote } from '../hooks/use-daily-sheets';

interface AddNoteDialogProps {
  open: boolean;
  onClose: () => void;
  itemId: string;
  sheetId: string;
  customerName: string;
  sequence: number;
}

type NoteTab = 'text' | 'voice';

interface RecordingResult {
  blob: Blob;
  durationSeconds: number;
  mimeType: string;
}

export function AddNoteDialog({
  open,
  onClose,
  itemId,
  sheetId,
  customerName,
  sequence,
}: AddNoteDialogProps) {
  const [tab, setTab] = useState<NoteTab>('text');
  const [text, setText] = useState('');
  const [recorded, setRecorded] = useState<RecordingResult | null>(null);

  const addText = useAddTextNote(sheetId);
  const addVoice = useAddVoiceNote(sheetId);

  const isPending = addText.isPending || addVoice.isPending;

  const handleClose = () => {
    if (isPending) return;
    setText('');
    setRecorded(null);
    setTab('text');
    onClose();
  };

  const handleSave = async () => {
    if (tab === 'text') {
      if (!text.trim()) return;
      await addText.mutateAsync({ itemId, text: text.trim() });
      handleClose();
    } else {
      if (!recorded) return;
      const fd = new FormData();
      fd.append('audio', new File([recorded.blob], 'voice-note.webm', { type: recorded.mimeType }));
      await addVoice.mutateAsync({ itemId, formData: fd, duration: recorded.durationSeconds });
      handleClose();
    }
  };

  const canSave = tab === 'text' ? text.trim().length > 0 : recorded !== null;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="rounded-3xl max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            Add Note
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            Stop #{sequence} · {customerName}
          </p>
        </DialogHeader>

        {/* Tab switcher */}
        <div className="flex gap-2 rounded-xl bg-muted/40 p-1">
          {([
            { key: 'text' as NoteTab, label: 'Text Note', icon: FileText },
            { key: 'voice' as NoteTab, label: 'Voice Note', icon: Mic },
          ] as const).map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={cn(
                'flex-1 flex items-center justify-center gap-2 rounded-lg py-2 text-sm font-bold transition-colors',
                tab === key
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>

        {tab === 'text' ? (
          <Textarea
            placeholder="Type your instruction for the driver..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="min-h-[120px] rounded-xl resize-none"
            maxLength={1000}
            autoFocus
          />
        ) : (
          <VoiceRecorder
            recorded={recorded}
            onRecorded={setRecorded}
            onClear={() => setRecorded(null)}
          />
        )}

        <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 px-3 py-2">
          <p className="text-xs font-bold text-amber-700 dark:text-amber-400">
            Driver must acknowledge this note before recording the delivery.
          </p>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" className="rounded-full font-bold" onClick={handleClose} disabled={isPending}>
            Cancel
          </Button>
          <Button
            className="rounded-full font-bold"
            onClick={handleSave}
            disabled={!canSave || isPending}
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            {tab === 'text' ? 'Save Note' : 'Upload Note'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
