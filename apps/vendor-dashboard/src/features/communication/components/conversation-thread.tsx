'use client';

import { Fragment, useEffect, useRef } from 'react';
import Link from 'next/link';
import { Button, Skeleton, cn } from '@water-supply-crm/ui';
import { Calendar, ChevronUp, ExternalLink, Loader2, MessagesSquare, Package, Truck } from 'lucide-react';
import type { ConversationMessageItem } from '@water-supply-crm/types';
import { useAuthStore } from '../../../store/auth.store';
import { useCan } from '../../authz/hooks/use-can';
import {
  useAcknowledgeMessage,
  useConversationForItem,
  useMarkRead,
  useMessages,
  useSendMessage,
  useSendVoiceMessage,
} from '../hooks/use-conversations';
import { AckGate } from './ack-gate';
import { MessageBubble } from './message-bubble';
import { MessageComposer } from './message-composer';

const formatDividerDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });

interface ConversationThreadProps {
  /** Anchor delivery item — every message sent from this thread instance is tagged with it. */
  itemId: string;
  sheetId: string;
  /**
   * 'embedded' = inside the Daily Sheet customer card (Phase 2) — shows the
   * "Open in Communications" reverse deep link (Phase 6).
   * 'inbox' = the Communication Center split-pane (Phase 3), which has its
   * own header/context block instead.
   */
  variant: 'embedded' | 'inbox';
  isDriver: boolean;
  /** True while the item is still PENDING — drives the composer's default "Instruction" toggle. */
  itemIsPending: boolean;
  /** Sheet is closed — thread is read-only, no composer. */
  isClosed: boolean;
}

/**
 * Delivery-context divider between message groups — the running thread spans
 * every delivery day for this customer, so whenever consecutive messages are
 * about a different item, a divider shows which one (with a link back to it).
 */
function DeliveryDivider({ item }: { item: ConversationMessageItem }) {
  return (
    <div className="flex items-center gap-2 py-1">
      <div className="h-px flex-1 bg-border/40" />
      <Link
        href={`/dashboard/daily-sheets/${item.dailySheetId}?item=${item.id}`}
        className="flex items-center gap-1.5 text-[10px] font-bold text-muted-foreground hover:text-primary shrink-0"
      >
        <Calendar className="h-3 w-3" />
        {formatDividerDate(item.dailySheet.date)}
        <Truck className="h-3 w-3 ml-1" />
        {item.dailySheet.van.plateNumber}
        <Package className="h-3 w-3 ml-1" />
        Stop #{item.sequence}
        <ExternalLink className="h-3 w-3 ml-0.5" />
      </Link>
      <div className="h-px flex-1 bg-border/40" />
    </div>
  );
}

/**
 * ★ The shared Communication Center thread (Communication Center Phase 2,
 * docs/features/customer-communication-center.md §6). Renders identically
 * regardless of variant; only the embedding shell differs. Replaces
 * item-notes-panel.tsx's ItemNotesPanel/DriverNoteGate + add-note-dialog.tsx
 * in the Daily Sheet card (see delivery-items-list.tsx).
 */
export function ConversationThread({ itemId, sheetId, variant, isDriver, itemIsPending, isClosed }: ConversationThreadProps) {
  const currentUserId = useAuthStore((s) => s.user?.id) ?? '';
  const canSend = useCan('conversations:send');
  const scrollRef = useRef<HTMLDivElement>(null);

  const conversationQuery = useConversationForItem(itemId, true);
  const conversationId = conversationQuery.data?.id;

  const messagesQuery = useMessages(conversationId, itemId, !!conversationId);
  const sendText = useSendMessage(conversationId ?? '', itemId);
  const sendVoice = useSendVoiceMessage(conversationId ?? '', itemId);
  const acknowledge = useAcknowledgeMessage(conversationId ?? '', sheetId);
  const markRead = useMarkRead(conversationId, itemId);

  // Oldest -> newest: infinite-query pages are fetched newest-page-first
  // (each fetchNextPage() call walks further into the past via `before`).
  const messages = [...(messagesQuery.data?.pages ?? [])].reverse().flatMap((p) => p.messages);
  const pendingAckCount = messages.filter((m) => m.requiresAck && !m.acknowledgedAt).length;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages.length]);

  // LOCKED §8: opening a thread / scrolling to the bottom marks it read.
  // Both variants share this component, so embedding (Phase 2) and inbox
  // (Phase 3) get read-state for free from the same effect.
  useEffect(() => {
    if (conversationId) markRead.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, messages.length]);

  if (conversationQuery.isLoading || !conversationQuery.data) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-16 w-2/3 rounded-2xl" />
        <Skeleton className="h-16 w-1/2 rounded-2xl ml-auto" />
      </div>
    );
  }

  const conversation = conversationQuery.data;
  const composerDisabled = isClosed || conversation.status === 'CLOSED' || !canSend;
  const composerDisabledReason = isClosed
    ? 'This sheet is closed — the conversation is read-only.'
    : conversation.status === 'CLOSED'
      ? 'This conversation is closed.'
      : "You don't have permission to send messages.";

  return (
    <div className={cn('space-y-3', variant === 'inbox' && 'h-full flex flex-col')}>
      {/* Reverse deep link (Phase 6, §6.1): the inbox variant already has its
          own header/context — only the embedded (Daily Sheet card) variant
          needs a way back to the centralized Communication Center. Carries
          item + sheet too: a just-created, zero-message conversation has no
          "last discussed delivery" rollup yet for the inbox to default to. */}
      {variant === 'embedded' && (
        <Link
          href={`/dashboard/communications?conversation=${conversation.id}&item=${itemId}&sheet=${sheetId}`}
          className="flex items-center gap-1.5 text-[11px] font-bold text-primary hover:underline w-fit"
        >
          <ExternalLink className="h-3 w-3" />
          Open in Communications
        </Link>
      )}

      {isDriver && <AckGate pendingCount={pendingAckCount} />}

      <div
        ref={scrollRef}
        className={cn(
          'flex flex-col gap-3 overflow-y-auto rounded-xl',
          variant === 'embedded' ? 'max-h-96 min-h-[80px]' : 'flex-1',
        )}
      >
        {messagesQuery.hasNextPage && (
          <Button
            size="sm"
            variant="ghost"
            className="mx-auto rounded-full font-bold text-xs gap-1.5"
            onClick={() => messagesQuery.fetchNextPage()}
            disabled={messagesQuery.isFetchingNextPage}
          >
            {messagesQuery.isFetchingNextPage ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <ChevronUp className="h-3 w-3" />
            )}
            Load earlier messages
          </Button>
        )}

        {messagesQuery.isLoading ? (
          <>
            <Skeleton className="h-14 w-2/3 rounded-2xl" />
            <Skeleton className="h-14 w-1/2 rounded-2xl ml-auto" />
          </>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-1.5 py-6 text-center">
            <MessagesSquare className="h-5 w-5 text-muted-foreground/50" />
            <p className="text-xs text-muted-foreground font-medium">No messages yet</p>
          </div>
        ) : (
          messages.map((message, idx) => (
            <Fragment key={message.id}>
              {(idx === 0 || messages[idx - 1].item.id !== message.item.id) && (
                <DeliveryDivider item={message.item} />
              )}
              <MessageBubble
                message={message}
                currentUserId={currentUserId}
                canAcknowledge={isDriver}
                onAcknowledge={(messageId) => acknowledge.mutate(messageId)}
                isAcknowledging={acknowledge.isPending}
              />
            </Fragment>
          ))
        )}
      </div>

      <MessageComposer
        canSetRequiresAck={!isDriver}
        defaultRequiresAck={itemIsPending}
        disabled={composerDisabled}
        disabledReason={composerDisabledReason}
        isSending={sendText.isPending || sendVoice.isPending}
        onSendText={(text, requiresAck) => sendText.mutate({ text, requiresAck })}
        onSendVoice={(recording, requiresAck) => {
          const formData = new FormData();
          formData.append('audio', new File([recording.blob], 'voice-message.webm', { type: recording.mimeType }));
          sendVoice.mutate({ formData, duration: recording.durationSeconds, requiresAck });
        }}
      />
    </div>
  );
}
