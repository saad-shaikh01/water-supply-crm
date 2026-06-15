'use client';

import { useState, useCallback } from 'react';
import { Button, Badge } from '@water-supply-crm/ui';
import {
  Mic, FileText, CheckCircle2, Clock, Play, Pause, StickyNote, Loader2,
} from 'lucide-react';
import { cn } from '@water-supply-crm/ui';
import type { DeliveryItemNote } from '@water-supply-crm/types';
import { useAcknowledgeNote, useNoteAudioUrl } from '../hooks/use-daily-sheets';

// ── Voice note player (fetches signed URL on demand) ─────────────────────────

function VoiceNotePlayer({ note }: { note: DeliveryItemNote }) {
  const [wantUrl, setWantUrl] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioEl, setAudioEl] = useState<HTMLAudioElement | null>(null);

  const { data, isLoading } = useNoteAudioUrl(note.id, wantUrl);

  const handlePlay = useCallback(() => {
    if (!wantUrl) {
      setWantUrl(true);
      return;
    }
    if (!data?.signedUrl) return;

    if (audioEl) {
      if (isPlaying) {
        audioEl.pause();
        setIsPlaying(false);
      } else {
        audioEl.play();
        setIsPlaying(true);
      }
      return;
    }

    const el = new Audio(data.signedUrl);
    el.onended = () => setIsPlaying(false);
    el.play();
    setIsPlaying(true);
    setAudioEl(el);
  }, [wantUrl, data, audioEl, isPlaying]);

  // Auto-play once URL is fetched
  if (wantUrl && data?.signedUrl && !audioEl && !isLoading) {
    const el = new Audio(data.signedUrl);
    el.onended = () => setIsPlaying(false);
    el.play();
    setIsPlaying(true);
    setAudioEl(el);
  }

  return (
    <button
      type="button"
      onClick={handlePlay}
      disabled={isLoading}
      className="flex items-center gap-2 rounded-lg bg-primary/10 border border-primary/20 px-3 py-1.5 text-xs font-bold text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
    >
      {isLoading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : isPlaying ? (
        <Pause className="h-3.5 w-3.5" />
      ) : (
        <Play className="h-3.5 w-3.5" />
      )}
      {note.audioDuration != null
        ? `${Math.floor(note.audioDuration / 60)}:${String(note.audioDuration % 60).padStart(2, '0')}`
        : 'Play'}
    </button>
  );
}

// ── Single note row ───────────────────────────────────────────────────────────

function NoteRow({
  note,
  sheetId,
  isDriver,
}: {
  note: DeliveryItemNote;
  sheetId: string;
  isDriver: boolean;
}) {
  const acknowledge = useAcknowledgeNote(sheetId);
  const isAcknowledged = !!note.acknowledgedAt;

  return (
    <div
      className={cn(
        'rounded-xl border p-3 space-y-2 transition-colors',
        isAcknowledged
          ? 'border-emerald-500/30 bg-emerald-500/5'
          : 'border-amber-500/40 bg-amber-500/5',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5">
          {note.type === 'VOICE' ? (
            <Mic className="h-3.5 w-3.5 text-primary shrink-0" />
          ) : (
            <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          )}
          <span className="text-xs font-bold">{note.createdBy.name}</span>
          <span className="text-[10px] text-muted-foreground">
            {new Date(note.createdAt).toLocaleTimeString('en-US', {
              hour: 'numeric',
              minute: '2-digit',
              hour12: true,
            })}
          </span>
        </div>
        {isAcknowledged ? (
          <Badge className="text-[9px] px-1.5 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-0 shrink-0">
            <CheckCircle2 className="h-2.5 w-2.5 mr-1" />
            Acknowledged
          </Badge>
        ) : (
          <Badge className="text-[9px] px-1.5 bg-amber-500/15 text-amber-700 dark:text-amber-400 border-0 shrink-0">
            <Clock className="h-2.5 w-2.5 mr-1" />
            Pending
          </Badge>
        )}
      </div>

      {note.type === 'TEXT' && note.text && (
        <p className="text-sm leading-relaxed">{note.text}</p>
      )}

      {note.type === 'VOICE' && (
        <VoiceNotePlayer note={note} />
      )}

      {isDriver && !isAcknowledged && (
        <Button
          size="sm"
          className="w-full rounded-xl font-bold h-9 gap-2"
          onClick={() => acknowledge.mutate(note.id)}
          disabled={acknowledge.isPending}
        >
          {acknowledge.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5" />
          )}
          I've Read / Listened — Acknowledge
        </Button>
      )}

      {isAcknowledged && note.acknowledgedAt && (
        <p className="text-[10px] text-muted-foreground">
          Acknowledged at{' '}
          {new Date(note.acknowledgedAt).toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
          })}
        </p>
      )}
    </div>
  );
}

// ── Driver Gate: blocks form until all notes acknowledged ─────────────────────

interface DriverNoteGateProps {
  notes: DeliveryItemNote[];
  sheetId: string;
}

export function DriverNoteGate({ notes, sheetId }: DriverNoteGateProps) {
  const pending = notes.filter((n) => !n.acknowledgedAt);

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 flex items-start gap-3">
        <StickyNote className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-black text-amber-700 dark:text-amber-400">
            Read Before Delivering
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Acknowledge {pending.length === 1 ? 'this note' : `all ${pending.length} notes`} to unlock the delivery form.
          </p>
        </div>
      </div>
      {notes.map((note) => (
        <NoteRow key={note.id} note={note} sheetId={sheetId} isDriver />
      ))}
    </div>
  );
}

// ── Admin/Staff Notes Panel ───────────────────────────────────────────────────

interface ItemNotesPanelProps {
  notes: DeliveryItemNote[];
  sheetId: string;
  isDriver: boolean;
}

export function ItemNotesPanel({ notes, sheetId, isDriver }: ItemNotesPanelProps) {
  if (notes.length === 0) return null;

  return (
    <div className="space-y-2">
      <p className="text-xs font-black uppercase text-muted-foreground flex items-center gap-1.5">
        <StickyNote className="h-3.5 w-3.5" />
        Admin Notes ({notes.length})
      </p>
      {notes.map((note) => (
        <NoteRow key={note.id} note={note} sheetId={sheetId} isDriver={isDriver} />
      ))}
    </div>
  );
}
