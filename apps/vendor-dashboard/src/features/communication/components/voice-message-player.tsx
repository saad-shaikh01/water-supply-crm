'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, Mic, Pause, Play } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@water-supply-crm/ui';
import type { ConversationMessage } from '@water-supply-crm/types';
import { useMarkMessagePlayed, useMessageAudioUrl } from '../hooks/use-conversations';

// Only one voice message plays at a time (WhatsApp behaviour): starting one
// pauses whichever other player is active. Module-level on purpose — every
// VoiceMessagePlayer instance on the page shares it.
let activeAudio: HTMLAudioElement | null = null;
// Playback speed is a listener preference, not a per-message one.
let preferredRate = 1;

const RATES = [1, 1.5, 2] as const;
const BAR_COUNT = 48;
const SEEK_STEP_SECONDS = 5;

const formatClock = (seconds: number) => {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * Real waveform peaks (0-100) when the backend stored them; null for voice
 * messages sent before waveform extraction existed or when extraction failed.
 */
function readWaveform(raw: unknown): number[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const bars = raw.map((v) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, 0, 100) : 0));
  return bars;
}

/**
 * Deterministic placeholder shape for legacy messages: seeded from the
 * message id so a given message always draws the same bars (no flicker across
 * re-renders/polls), smoothed so it reads like speech rather than noise.
 */
function placeholderWaveform(seed: string): number[] {
  let state = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    state ^= seed.charCodeAt(i);
    state = Math.imul(state, 16777619);
  }
  const next = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
  const bars: number[] = [];
  let prev = 0.5;
  for (let i = 0; i < BAR_COUNT; i++) {
    prev = prev * 0.5 + next() * 0.5;
    bars.push(Math.round(25 + prev * 75));
  }
  return bars;
}

interface VoiceMessagePlayerProps {
  message: ConversationMessage;
  /** Sent by the current user — drives colour treatment and the "played" tick. */
  isOwn?: boolean;
}

/**
 * WhatsApp-style voice player: play/pause, waveform that fills as it plays,
 * click/drag to seek, elapsed/total time, 1x/1.5x/2x speed, single playback
 * across the page, and a played indicator on the mic icon.
 *
 * The signed audio URL is still fetched lazily on first tap/seek; audio-element
 * creation lives in an effect keyed on that URL (not setState-during-render).
 */
export function VoiceMessagePlayer({ message, isOwn = false }: VoiceMessagePlayerProps) {
  const queryClient = useQueryClient();
  const [wantUrl, setWantUrl] = useState(false);
  const { data, isLoading, isError, refetch } = useMessageAudioUrl(message.id, wantUrl);
  const markPlayed = useMarkMessagePlayed();

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pendingSeekRef = useRef<number | null>(null); // fraction 0-1 requested before audio was ready
  const trackRef = useRef<HTMLDivElement | null>(null);
  const markedRef = useRef(false);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [mediaDuration, setMediaDuration] = useState<number | null>(null);
  const [scrubFraction, setScrubFraction] = useState<number | null>(null);
  const [rate, setRate] = useState<number>(preferredRate);
  const [playedLocal, setPlayedLocal] = useState(false);

  // Latest values for the long-lived audio listeners below (the effect only
  // re-runs when the URL changes).
  const latest = useRef({ isOwn, alreadyPlayed: !!message.playedAt, messageId: message.id, fallbackDuration: message.audioDuration });
  latest.current = { isOwn, alreadyPlayed: !!message.playedAt, messageId: message.id, fallbackDuration: message.audioDuration };
  const markPlayedRef = useRef(markPlayed.mutate);
  markPlayedRef.current = markPlayed.mutate;

  // Total length: real media duration once known (webm/ogg files can report
  // Infinity, which is ignored), else the duration stored when it was sent.
  const totalSeconds =
    mediaDuration && mediaDuration > 0 ? mediaDuration : (message.audioDuration ?? 0);

  const bars = useMemo(
    () => readWaveform(message.audioWaveform) ?? placeholderWaveform(message.id),
    [message.audioWaveform, message.id],
  );

  const playableDuration = (el: HTMLAudioElement): number => {
    if (Number.isFinite(el.duration) && el.duration > 0) return el.duration;
    return latest.current.fallbackDuration ?? 0;
  };

  const seekFraction = (el: HTMLAudioElement, fraction: number) => {
    const duration = playableDuration(el);
    if (duration <= 0) return;
    el.currentTime = clamp(fraction, 0, 1) * duration;
    setCurrentTime(el.currentTime);
  };

  // Build the audio element once the signed URL resolves; auto-play for the
  // tap that requested it.
  useEffect(() => {
    if (!wantUrl || !data?.signedUrl) return;
    const el = new Audio(data.signedUrl);
    el.preload = 'auto';
    el.playbackRate = preferredRate;
    audioRef.current = el;

    const reportPlayFailure = (err: unknown) => {
      setIsPlaying(false);
      // Autoplay-policy block (the tap → fetch → play chain can lose the user
      // gesture on Safari): element is ready, a second tap simply plays it.
      if ((err as DOMException)?.name === 'NotAllowedError') return;
      toast.error('Could not play this voice message on this device/browser.');
    };

    const onPlay = () => {
      if (activeAudio && activeAudio !== el) activeAudio.pause();
      activeAudio = el;
      setIsPlaying(true);
      const { isOwn: own, alreadyPlayed, messageId } = latest.current;
      if (!own && !alreadyPlayed && !markedRef.current) {
        markedRef.current = true;
        setPlayedLocal(true);
        markPlayedRef.current(messageId);
      }
    };
    const onPause = () => setIsPlaying(false);
    const onEnded = () => {
      setIsPlaying(false);
      el.currentTime = 0;
      setCurrentTime(0);
    };
    const onMeta = () => {
      if (Number.isFinite(el.duration) && el.duration > 0) setMediaDuration(el.duration);
      if (pendingSeekRef.current != null) {
        seekFraction(el, pendingSeekRef.current);
        pendingSeekRef.current = null;
      }
    };
    // A signed URL expires after 15 min; a seek/resume after that fails. Drop
    // the element and the cached URL so the next tap fetches a fresh one.
    const onError = () => {
      setIsPlaying(false);
      toast.error('Could not play this voice message on this device/browser.');
      audioRef.current = null;
      queryClient.removeQueries({ queryKey: ['message-audio-url', latest.current.messageId] });
      setWantUrl(false);
    };

    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('ended', onEnded);
    el.addEventListener('loadedmetadata', onMeta);
    el.addEventListener('durationchange', onMeta);
    el.addEventListener('error', onError);

    el.play().catch(reportPlayFailure);

    return () => {
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('ended', onEnded);
      el.removeEventListener('loadedmetadata', onMeta);
      el.removeEventListener('durationchange', onMeta);
      el.removeEventListener('error', onError);
      el.pause();
      if (activeAudio === el) activeAudio = null;
      if (audioRef.current === el) audioRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantUrl, data?.signedUrl]);

  // Smooth progress: timeupdate only fires ~4x/s, which makes the waveform
  // fill look steppy — sample the element every frame while playing instead.
  useEffect(() => {
    if (!isPlaying) return;
    let frame = 0;
    const tick = () => {
      const el = audioRef.current;
      if (el) setCurrentTime(el.currentTime);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [isPlaying]);

  const handleToggle = useCallback(() => {
    if (!wantUrl) {
      setWantUrl(true); // effect creates the element and auto-plays
      return;
    }
    const el = audioRef.current;
    if (!el) {
      if (isError) refetch();
      return; // still loading
    }
    if (el.paused) {
      el.play().catch((err: unknown) => {
        setIsPlaying(false);
        if ((err as DOMException)?.name !== 'NotAllowedError') {
          toast.error('Could not play this voice message on this device/browser.');
        }
      });
    } else {
      el.pause();
    }
  }, [wantUrl, isError, refetch]);

  const requestSeek = (fraction: number) => {
    const el = audioRef.current;
    if (el) {
      seekFraction(el, fraction);
      return;
    }
    // Not loaded yet: remember the target, start loading; applied (and played)
    // as soon as metadata arrives.
    pendingSeekRef.current = fraction;
    setCurrentTime(fraction * (message.audioDuration ?? 0));
    if (!wantUrl) setWantUrl(true);
  };

  const fractionFromPointer = (e: PointerEvent<HTMLDivElement>) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return 0;
    return clamp((e.clientX - rect.left) / rect.width, 0, 1);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setScrubFraction(fractionFromPointer(e));
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (scrubFraction == null) return;
    setScrubFraction(fractionFromPointer(e));
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (scrubFraction == null) return;
    requestSeek(fractionFromPointer(e));
    setScrubFraction(null);
  };
  const onPointerCancel = () => setScrubFraction(null);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const el = audioRef.current;
    if (!el || totalSeconds <= 0) return;
    e.preventDefault();
    const delta = e.key === 'ArrowRight' ? SEEK_STEP_SECONDS : -SEEK_STEP_SECONDS;
    seekFraction(el, (el.currentTime + delta) / totalSeconds);
  };

  const cycleRate = () => {
    const nextRate = RATES[(RATES.findIndex((r) => r === rate) + 1) % RATES.length];
    preferredRate = nextRate;
    setRate(nextRate);
    if (audioRef.current) audioRef.current.playbackRate = nextRate;
  };

  const progress =
    scrubFraction ?? (totalSeconds > 0 ? clamp(currentTime / totalSeconds, 0, 1) : 0);
  const shownSeconds = scrubFraction != null ? scrubFraction * totalSeconds : currentTime;
  const started = isPlaying || currentTime > 0 || scrubFraction != null;
  const isPlayed = !!message.playedAt || playedLocal;
  const showSpeed = wantUrl && (isPlaying || currentTime > 0);

  return (
    <div className={cn('flex items-center gap-2.5', isOwn ? 'text-primary-foreground' : 'text-primary')}>
      <button
        type="button"
        onClick={handleToggle}
        disabled={isLoading}
        aria-label={isPlaying ? 'Pause voice message' : 'Play voice message'}
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-60',
          isOwn ? 'bg-primary-foreground/20 hover:bg-primary-foreground/30' : 'bg-primary/15 hover:bg-primary/25',
        )}
      >
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : isPlaying ? (
          <Pause className="h-4 w-4 fill-current" />
        ) : (
          <Play className="h-4 w-4 fill-current ml-0.5" />
        )}
      </button>

      <div className="flex w-44 flex-col gap-1">
        <div
          ref={trackRef}
          role="slider"
          tabIndex={0}
          aria-label="Voice message position"
          aria-valuemin={0}
          aria-valuemax={Math.round(totalSeconds)}
          aria-valuenow={Math.round(shownSeconds)}
          aria-valuetext={`${formatClock(shownSeconds)} of ${formatClock(totalSeconds)}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onKeyDown={onKeyDown}
          className="flex h-7 cursor-pointer touch-none select-none items-center gap-px rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {bars.map((height, i) => (
            <span
              key={i}
              className="flex-1 rounded-full bg-current transition-opacity"
              style={{
                height: `${Math.max(14, height)}%`,
                opacity: (i + 0.5) / bars.length <= progress ? 1 : 0.35,
              }}
            />
          ))}
        </div>

        <div className="flex items-center justify-between text-[10px] font-semibold tabular-nums leading-none">
          <span className="opacity-80">
            {started ? `${formatClock(shownSeconds)} / ${formatClock(totalSeconds)}` : formatClock(totalSeconds)}
          </span>
          <span className="flex items-center gap-1.5">
            {showSpeed && (
              <button
                type="button"
                onClick={cycleRate}
                aria-label={`Playback speed ${rate}x`}
                className={cn(
                  'rounded-full px-1.5 py-0.5 text-[9px] font-black leading-none',
                  isOwn ? 'bg-primary-foreground/20' : 'bg-primary/15',
                )}
              >
                {rate}x
              </button>
            )}
            <Mic
              aria-label={isPlayed ? 'Played' : 'Not played yet'}
              className={cn(
                'h-3.5 w-3.5 shrink-0',
                isPlayed
                  ? isOwn
                    ? 'text-sky-300'
                    : 'text-sky-500'
                  : isOwn
                    ? 'opacity-70'
                    : 'text-emerald-500',
              )}
            />
          </span>
        </div>
      </div>
    </div>
  );
}
