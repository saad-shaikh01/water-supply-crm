'use client';

import { Avatar, AvatarFallback, Badge, Skeleton, cn } from '@water-supply-crm/ui';
import { Mic, Truck, User } from 'lucide-react';
import type { ConversationContext } from '@water-supply-crm/types';
import type { ConversationListItem } from '../api/conversations.api';

const STATUS_STYLES: Record<ConversationContext['status'], string> = {
  OPEN: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  RESOLVED: 'bg-blue-500/15 text-blue-700 dark:text-blue-400',
  CLOSED: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400',
};

const initials = (name: string) =>
  name.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '?';

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { day: 'numeric', month: 'short' });

const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

interface ConversationListProps {
  conversations: ConversationListItem[];
  selectedId: string | null;
  onSelect: (conversation: ConversationListItem) => void;
  isLoading: boolean;
}

/**
 * Inbox rows for the Communication Center. Unread indicator added Phase 4
 * (backed by the per-row `unreadCount` the list endpoint always returned —
 * Phase 3 deliberately left it unrendered). "Waiting on" chip added Phase 5
 * (same story: `waitingOn` was always in the response, unrendered until
 * now). No interactive status control here — those live on
 * conversation-header.tsx; status is shown here as a plain badge.
 */
export function ConversationList({ conversations, selectedId, onSelect, isLoading }: ConversationListProps) {
  if (isLoading) {
    return (
      <div className="space-y-2 p-3">
        {[1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-[72px] w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-1.5 py-16 text-center px-6">
        <p className="text-sm font-bold text-muted-foreground">No conversations found</p>
        <p className="text-xs text-muted-foreground/70">Try adjusting your filters.</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-border/40">
      {conversations.map((c) => {
        const isSelected = c.id === selectedId;
        const isVoicePreview = c.lastMessagePreview === '🎤 Voice message';
        const hasUnread = c.unreadCount > 0;
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => onSelect(c)}
            className={cn(
              'w-full flex items-start gap-3 px-4 py-3 text-left transition-colors',
              isSelected ? 'bg-primary/10' : 'hover:bg-accent/40',
            )}
          >
            <div className="relative shrink-0">
              <Avatar className="h-10 w-10">
                <AvatarFallback className="text-xs font-black bg-primary/15 text-primary">
                  {initials(c.customer.name)}
                </AvatarFallback>
              </Avatar>
              {hasUnread && (
                <span className="absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full bg-primary border-2 border-background" />
              )}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-baseline gap-1 min-w-0 flex-1">
                  <span className={cn('text-sm truncate', hasUnread ? 'font-black' : 'font-bold')}>
                    {c.customer.name}
                  </span>
                  <span className="text-[10px] text-muted-foreground font-mono shrink-0">
                    ({c.customer.customerCode})
                  </span>
                </span>
                {c.lastMessageAt && (
                  <span className={cn('text-[10px] shrink-0', hasUnread ? 'text-primary font-bold' : 'text-muted-foreground')}>
                    {formatTime(c.lastMessageAt)}
                  </span>
                )}
              </div>

              <div className="flex items-center justify-between gap-2 mt-0.5">
                <p className={cn(
                  'text-xs truncate flex items-center gap-1',
                  hasUnread ? 'text-foreground font-bold' : isVoicePreview ? 'text-primary font-medium' : 'text-muted-foreground',
                )}>
                  {isVoicePreview && <Mic className="h-3 w-3 shrink-0" />}
                  {c.lastMessagePreview ?? 'No messages yet'}
                </p>
                {hasUnread && (
                  <span className="shrink-0 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-black leading-none">
                    {c.unreadCount > 99 ? '99+' : c.unreadCount}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                <Badge className={cn('text-[9px] px-1.5 border-0', STATUS_STYLES[c.status])}>{c.status}</Badge>
                {c.waitingOn && (
                  <Badge variant="outline" className="text-[9px] px-1.5 font-medium">
                    {c.waitingOn === 'DRIVER' ? 'Waiting: Driver' : 'Waiting: Office'}
                  </Badge>
                )}
                {/* Nullable "last discussed delivery" rollup — only unset in
                    the brief window between get-or-create and first send;
                    every row reaching this list already has messageCount > 0. */}
                {c.van && (
                  <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <Truck className="h-2.5 w-2.5" />
                    {c.van.plateNumber}
                  </span>
                )}
                {c.driver && (
                  <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <User className="h-2.5 w-2.5" />
                    {c.driver.name}
                  </span>
                )}
                {c.dailySheet && (
                  <span className="text-[10px] text-muted-foreground">· {formatDate(c.dailySheet.date)}</span>
                )}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
