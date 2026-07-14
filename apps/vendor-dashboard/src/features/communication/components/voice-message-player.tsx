'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Pause, Play } from 'lucide-react';
import type { ConversationMessage } from '@water-supply-crm/types';
import { useMessageAudioUrl } from '../hooks/use-conversations';

/**
 * Fetches the signed audio URL on demand (first tap) and plays it. Lifted
 * from item-notes-panel.tsx's VoiceNotePlayer (Communication Center Phase 2).
 *
 * FIX vs the original: audio-element creation moved into a useEffect keyed on
 * the resolved signedUrl, instead of calling setState during render (the
 * original called setAudioEl mid-render when data arrived, which is a React
 * anti-pattern — works by accident via the extra render it forces, but can
 * double-fire on fast re-renders / StrictMode).
 */
export function VoiceMessagePlayer({ message }: { message: ConversationMessage }) {
  const [wantUrl, setWantUrl] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioEl, setAudioEl] = useState<HTMLAudioElement | null>(null);

  const { data, isLoading } = useMessageAudioUrl(message.id, wantUrl);

  // Create (and auto-play) the audio element once the signed URL resolves.
  useEffect(() => {
    if (!wantUrl || !data?.signedUrl || audioEl) return;
    const el = new Audio(data.signedUrl);
    el.onended = () => setIsPlaying(false);
    el.play();
    setIsPlaying(true);
    setAudioEl(el);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantUrl, data?.signedUrl]);

  useEffect(() => {
    return () => {
      audioEl?.pause();
    };
  }, [audioEl]);

  const handlePlay = useCallback(() => {
    if (!wantUrl) {
      setWantUrl(true);
      return;
    }
    if (!audioEl) return;
    if (isPlaying) {
      audioEl.pause();
      setIsPlaying(false);
    } else {
      audioEl.play();
      setIsPlaying(true);
    }
  }, [wantUrl, audioEl, isPlaying]);

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
      {message.audioDuration != null
        ? `${Math.floor(message.audioDuration / 60)}:${String(message.audioDuration % 60).padStart(2, '0')}`
        : 'Play'}
    </button>
  );
}
