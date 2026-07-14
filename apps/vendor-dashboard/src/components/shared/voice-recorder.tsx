'use client';

import { useState, useRef, useCallback } from 'react';
import { Mic, Square, Trash2, Play, Pause } from 'lucide-react';
import { cn } from '@water-supply-crm/ui';

interface RecordingResult {
  blob: Blob;
  durationSeconds: number;
  mimeType: string;
}

interface VoiceRecorderProps {
  onRecorded: (result: RecordingResult) => void;
  onClear: () => void;
  recorded: RecordingResult | null;
}

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function VoiceRecorder({ onRecorded, onClear, recorded }: VoiceRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const startTimeRef = useRef<number>(0);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/ogg';
      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      startTimeRef.current = Date.now();

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const durationSeconds = Math.round((Date.now() - startTimeRef.current) / 1000);
        const blob = new Blob(chunksRef.current, { type: mimeType });
        stream.getTracks().forEach((t) => t.stop());
        onRecorded({ blob, durationSeconds, mimeType });
      };

      recorder.start(250);
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      setElapsed(0);

      timerRef.current = setInterval(() => {
        setElapsed((prev) => prev + 1);
      }, 1000);
    } catch {
      // microphone access denied or not available — surface nothing, let the user retry
    }
  }, [onRecorded]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setIsRecording(false);
  }, []);

  const handlePlayPause = useCallback(() => {
    if (!recorded) return;
    if (!audioRef.current) {
      audioRef.current = new Audio(URL.createObjectURL(recorded.blob));
      audioRef.current.onended = () => setIsPlaying(false);
    }
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play();
      setIsPlaying(true);
    }
  }, [recorded, isPlaying]);

  const handleClear = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setIsPlaying(false);
    setElapsed(0);
    onClear();
  }, [onClear]);

  if (recorded) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-border/40 bg-background/70 px-4 py-3">
        <button
          type="button"
          onClick={handlePlayPause}
          className="h-9 w-9 rounded-full bg-primary flex items-center justify-center text-primary-foreground shrink-0"
        >
          {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </button>
        <div className="flex-1">
          <p className="text-sm font-bold">Voice Note</p>
          <p className="text-xs text-muted-foreground">{formatDuration(recorded.durationSeconds)}</p>
        </div>
        <button
          type="button"
          onClick={handleClear}
          className="h-8 w-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4 py-4">
      {isRecording && (
        <p className="text-sm font-bold text-destructive tabular-nums">
          {formatDuration(elapsed)}
        </p>
      )}
      <button
        type="button"
        onClick={isRecording ? stopRecording : startRecording}
        className={cn(
          'h-16 w-16 rounded-full flex items-center justify-center transition-all',
          isRecording
            ? 'bg-destructive text-white animate-pulse'
            : 'bg-primary/10 text-primary hover:bg-primary/20',
        )}
      >
        {isRecording ? <Square className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
      </button>
      <p className="text-xs text-muted-foreground">
        {isRecording ? 'Tap to stop recording' : 'Tap to start recording'}
      </p>
    </div>
  );
}
