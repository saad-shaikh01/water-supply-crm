'use client';

import { useEffect, useState } from 'react';
import { Button, Textarea, cn } from '@water-supply-crm/ui';
import { FileText, Loader2, Mic, Send, ShieldAlert } from 'lucide-react';
import { VoiceRecorder } from '../../../components/shared/voice-recorder';

type ComposerTab = 'text' | 'voice';

interface RecordingResult {
  blob: Blob;
  durationSeconds: number;
  mimeType: string;
}

interface MessageComposerProps {
  onSendText: (text: string, requiresAck: boolean) => void;
  onSendVoice: (recording: RecordingResult, requiresAck: boolean) => void;
  isSending: boolean;
  /** Office (ADMIN/STAFF) may flag a message as a blocking instruction; drivers cannot. */
  canSetRequiresAck: boolean;
  /** "Instruction" default: ON while the delivery is still PENDING (LOCKED §9). */
  defaultRequiresAck: boolean;
  disabled?: boolean;
  disabledReason?: string;
}

/**
 * Persistent inline composer (Communication Center Phase 2) — replaces
 * add-note-dialog.tsx's modal. Reuses the same text/voice tab pattern and
 * the shared VoiceRecorder; adds the office-only "Instruction" toggle that
 * carries forward the old note system's always-blocking behavior as an
 * explicit per-message choice (requiresAck).
 */
export function MessageComposer({
  onSendText,
  onSendVoice,
  isSending,
  canSetRequiresAck,
  defaultRequiresAck,
  disabled,
  disabledReason,
}: MessageComposerProps) {
  const [tab, setTab] = useState<ComposerTab>('text');
  const [text, setText] = useState('');
  const [recorded, setRecorded] = useState<RecordingResult | null>(null);
  const [requiresAck, setRequiresAck] = useState(defaultRequiresAck);

  // Re-sync the default when the underlying delivery's status changes
  // (e.g. PENDING -> COMPLETED while the thread stays open).
  useEffect(() => setRequiresAck(defaultRequiresAck), [defaultRequiresAck]);

  const handleSend = () => {
    if (tab === 'text') {
      if (!text.trim()) return;
      onSendText(text.trim(), canSetRequiresAck && requiresAck);
      setText('');
    } else {
      if (!recorded) return;
      onSendVoice(recorded, canSetRequiresAck && requiresAck);
      setRecorded(null);
    }
  };

  const canSend = tab === 'text' ? text.trim().length > 0 : recorded !== null;

  if (disabled) {
    return (
      <div className="rounded-xl border border-dashed border-border/50 px-4 py-3 text-center">
        <p className="text-xs text-muted-foreground font-medium">
          {disabledReason ?? 'This conversation is read-only.'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2.5 rounded-xl border border-border/40 bg-background/70 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-1 rounded-lg bg-muted/40 p-1">
          {([
            { key: 'text' as ComposerTab, label: 'Text', icon: FileText },
            { key: 'voice' as ComposerTab, label: 'Voice', icon: Mic },
          ] as const).map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-bold transition-colors',
                tab === key ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>

        {canSetRequiresAck && (
          <button
            type="button"
            onClick={() => setRequiresAck((v) => !v)}
            className={cn(
              'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold border transition-colors',
              requiresAck
                ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/40'
                : 'bg-transparent text-muted-foreground border-border/50 hover:border-border',
            )}
            title="When on, the driver must acknowledge this message before recording the delivery"
          >
            <ShieldAlert className="h-3 w-3" />
            Instruction
          </button>
        )}
      </div>

      {tab === 'text' ? (
        <Textarea
          placeholder="Type a message…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="min-h-[70px] rounded-xl resize-none text-sm"
          maxLength={1000}
        />
      ) : (
        <VoiceRecorder recorded={recorded} onRecorded={setRecorded} onClear={() => setRecorded(null)} />
      )}

      <div className="flex justify-end">
        <Button
          size="sm"
          className="rounded-full font-bold gap-1.5"
          onClick={handleSend}
          disabled={!canSend || isSending}
        >
          {isSending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          Send
        </Button>
      </div>
    </div>
  );
}
