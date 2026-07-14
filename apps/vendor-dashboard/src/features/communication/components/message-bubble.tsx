'use client';

import { CheckCircle2, Clock, Loader2, Mic, ShieldAlert } from 'lucide-react';
import { Badge, Button, cn } from '@water-supply-crm/ui';
import type { ConversationMessage } from '@water-supply-crm/types';
import { VoiceMessagePlayer } from './voice-message-player';

const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

interface MessageBubbleProps {
  message: ConversationMessage;
  currentUserId: string;
  /** Only DRIVER may acknowledge — mirrors the pre-existing note-acknowledgement rule. */
  canAcknowledge: boolean;
  onAcknowledge: (messageId: string) => void;
  isAcknowledging: boolean;
}

/**
 * Evolved from item-notes-panel.tsx's NoteRow (Communication Center Phase 2):
 * now sender-aligned like a chat bubble, carries a requiresAck "Instruction"
 * badge, and owns its own acknowledge action inline instead of a separate
 * gate wrapper — ack-gate.tsx now only renders the summary banner above.
 */
export function MessageBubble({
  message,
  currentUserId,
  canAcknowledge,
  onAcknowledge,
  isAcknowledging,
}: MessageBubbleProps) {
  const isOwn = message.createdBy.id === currentUserId;
  const isAcknowledged = !!message.acknowledgedAt;
  const showAckAction = message.requiresAck && !isAcknowledged && canAcknowledge && !isOwn;

  return (
    <div className={cn('flex flex-col gap-1 max-w-[85%]', isOwn ? 'items-end self-end' : 'items-start self-start')}>
      <div className="flex items-center gap-1.5 px-1">
        <span className="text-[10px] font-bold text-muted-foreground">{message.createdBy.name}</span>
        <span className="text-[10px] text-muted-foreground">{formatTime(message.createdAt)}</span>
      </div>

      <div
        className={cn(
          'rounded-2xl px-3.5 py-2.5 space-y-2 border',
          isOwn
            ? 'bg-primary text-primary-foreground border-primary rounded-tr-sm'
            : message.requiresAck && !isAcknowledged
              ? 'bg-amber-500/10 border-amber-500/40 rounded-tl-sm'
              : 'bg-accent/60 border-border/40 rounded-tl-sm',
        )}
      >
        {message.requiresAck && (
          <div className="flex items-center gap-1">
            <ShieldAlert className={cn('h-3 w-3', isOwn ? 'opacity-80' : 'text-amber-600 dark:text-amber-400')} />
            <span className={cn('text-[9px] font-black uppercase tracking-wide', isOwn ? 'opacity-80' : 'text-amber-700 dark:text-amber-400')}>
              Instruction
            </span>
          </div>
        )}

        {message.type === 'TEXT' && message.text && (
          <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{message.text}</p>
        )}

        {message.type === 'VOICE' && (
          <div className="flex items-center gap-1.5">
            <Mic className={cn('h-3.5 w-3.5 shrink-0', isOwn ? 'opacity-80' : 'text-primary')} />
            <VoiceMessagePlayer message={message} />
          </div>
        )}

        {message.requiresAck && (
          <div className="flex items-center gap-1">
            {isAcknowledged ? (
              <Badge className="text-[9px] px-1.5 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-0">
                <CheckCircle2 className="h-2.5 w-2.5 mr-1" />
                Acknowledged
              </Badge>
            ) : (
              <Badge className={cn('text-[9px] px-1.5 border-0', isOwn ? 'bg-white/20' : 'bg-amber-500/15 text-amber-700 dark:text-amber-400')}>
                <Clock className="h-2.5 w-2.5 mr-1" />
                Pending
              </Badge>
            )}
          </div>
        )}

        {showAckAction && (
          <Button
            size="sm"
            className="w-full rounded-xl font-bold h-9 gap-2"
            onClick={() => onAcknowledge(message.id)}
            disabled={isAcknowledging}
          >
            {isAcknowledging ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            I've Read / Listened — Acknowledge
          </Button>
        )}
      </div>
    </div>
  );
}
