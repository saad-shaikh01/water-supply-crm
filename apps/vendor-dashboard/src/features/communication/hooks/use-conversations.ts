import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ConversationContext } from '@water-supply-crm/types';
import {
  conversationsApi,
  type ConversationStatusValue,
  type InboxQuery,
  type InboxResponse,
  type MessagesPage,
} from '../api/conversations.api';
import { queryKeys } from '../../../lib/query-keys';

// Shared by every mutation that changes a conversation's status/rollups and
// needs the inbox list + sidebar badge to reflect it without waiting for
// their next poll tick (['conversations', ...] is a prefix match: it covers
// every queryKeys.communication.inbox(...) entry AND UNREAD_BADGE_KEY below).
const INBOX_AND_BADGE_PREFIX = ['conversations'] as const;

// Locked polling intervals (docs/features/customer-communication-center.md §3): thread 15s,
// inbox 30s, badge 60s.
const THREAD_POLL_MS = 15_000;
const INBOX_POLL_MS = 30_000;
const BADGE_POLL_MS = 60_000;

// Global root — distinct from queryKeys.communication.inbox(params) so a
// mark-read can invalidate the badge without also matching every inbox
// filter combination (and vice versa), while both can still be bulk-cleared
// via ['conversations'] prefix when both should refresh together.
const UNREAD_BADGE_KEY = ['conversations', 'unread-count'] as const;

/** Communication Center inbox list (Phase 3). Polls every 30s (Phase 4). */
export const useInbox = (query: InboxQuery) => {
  return useQuery({
    queryKey: queryKeys.communication.inbox(query),
    queryFn: (): Promise<InboxResponse> => conversationsApi.findMany(query),
    placeholderData: (prev) => prev,
    refetchInterval: INBOX_POLL_MS,
  });
};

/**
 * Idempotent get-or-create for the item's conversation. Lazy — pass
 * `enabled` so it only fires when the delivery card is expanded.
 */
export const useConversationForItem = (itemId: string, enabled: boolean) => {
  return useQuery({
    queryKey: queryKeys.communication.forItem(itemId),
    queryFn: (): Promise<ConversationContext> => conversationsApi.getOrCreateForItem(itemId),
    enabled: enabled && !!itemId,
    // Get-or-create never goes stale on its own — it only changes via
    // mutations, which already invalidate this exact query key. Without
    // this, every collapse/expand of the same delivery card re-hits the
    // API even though the result can never differ.
    staleTime: Infinity,
  });
};

/**
 * Cursor-paginated message history, oldest-first within each loaded page.
 * Polls every 15s (Phase 4) — TanStack Query refetches every currently
 * loaded page on each tick (bounded by how many "Load earlier" clicks the
 * user has made in this session), which is what surfaces new messages.
 */
export const useMessages = (conversationId: string | undefined, itemId: string, enabled: boolean) => {
  return useInfiniteQuery({
    queryKey: queryKeys.communication.messages(conversationId ?? ''),
    queryFn: ({ pageParam }: { pageParam: string | undefined }): Promise<MessagesPage> =>
      conversationsApi.getMessages(conversationId as string, itemId, pageParam),
    enabled: enabled && !!conversationId,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    refetchInterval: THREAD_POLL_MS,
  });
};

// itemId is only used to refresh the conversation-context rollups
// (messageCount/lastMessagePreview) — scoped to conversation caches, per the
// locked rule that sending a message must NOT invalidate the sheet query.
//
// Also invalidates the inbox/badge prefix (Phase 5): a message into a
// RESOLVED conversation auto-reopens it server-side (LOCKED §7), and the
// inbox list should reflect that immediately rather than waiting up to 30s
// for its own poll — this does not touch queryKeys.sheets.one, so the
// Phase 2 rule ("sending must NOT invalidate the sheet") still holds.
export const useSendMessage = (conversationId: string, itemId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { text: string; requiresAck?: boolean }) =>
      conversationsApi.sendText(conversationId, { ...data, itemId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.communication.messages(conversationId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.communication.forItem(itemId) });
      queryClient.invalidateQueries({ queryKey: INBOX_AND_BADGE_PREFIX });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to send message'),
  });
};

export const useSendVoiceMessage = (conversationId: string, itemId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      formData,
      duration,
      requiresAck,
    }: {
      formData: FormData;
      duration?: number;
      requiresAck?: boolean;
    }) => conversationsApi.sendVoice(conversationId, formData, { itemId, duration, requiresAck }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.communication.messages(conversationId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.communication.forItem(itemId) });
      queryClient.invalidateQueries({ queryKey: INBOX_AND_BADGE_PREFIX });
    },
    onError: () => toast.error('Failed to send voice message'),
  });
};

/**
 * Acknowledging is the one message action that also affects the sheet's
 * ack-gate (canRecord), so — and only so, per the locked cache-scoping rule —
 * it invalidates queryKeys.sheets.one(sheetId) in addition to the thread.
 */
export const useAcknowledgeMessage = (conversationId: string, sheetId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (messageId: string) => conversationsApi.acknowledgeMessage(messageId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.communication.messages(conversationId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.sheets.one(sheetId) });
    },
    onError: () => toast.error('Failed to acknowledge message'),
  });
};

export const useMessageAudioUrl = (messageId: string, enabled: boolean) => {
  return useQuery({
    queryKey: ['message-audio-url', messageId],
    queryFn: () => conversationsApi.getMessageAudioUrl(messageId),
    enabled: enabled && !!messageId,
    staleTime: 1000 * 60 * 10, // 10 min (signed URL valid for 15 min)
    gcTime: 1000 * 60 * 12,
  });
};

/**
 * Upserts the caller's read watermark (LOCKED §8: "opening a thread ...
 * fires one PATCH /conversations/:id/read"). Invalidates the ['conversations']
 * prefix (every inbox row's unreadCount) and the global badge together —
 * deliberately NOT the message thread itself (reading doesn't change any
 * message content) and NOT queryKeys.sheets.one (mirrors the Phase 2 rule
 * that only acknowledgement, not read state, affects the delivery gate).
 */
export const useMarkRead = (conversationId: string | undefined, itemId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => conversationsApi.markRead(conversationId as string, itemId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: INBOX_AND_BADGE_PREFIX });
    },
  });
};

/** Sidebar unread badge (Phase 4). Polls every 60s. */
export const useUnreadBadge = () => {
  return useQuery({
    queryKey: UNREAD_BADGE_KEY,
    queryFn: () => conversationsApi.getUnreadCount(),
    refetchInterval: BADGE_POLL_MS,
  });
};

/**
 * Status workflow (Phase 5) — the endpoint itself (transitions, the
 * CLOSED-can-only-reopen guard, audit logging) is entirely server-side,
 * built in Phase 1; this mutation only wires it up. `itemId` is optional so
 * this can be used both from the inbox (which always knows it via the
 * selected row) and, in principle, anywhere else a conversation is resolved.
 */
export const useSetStatus = (conversationId: string, itemId?: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (status: ConversationStatusValue) => conversationsApi.setStatus(conversationId, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: INBOX_AND_BADGE_PREFIX });
      if (itemId) queryClient.invalidateQueries({ queryKey: queryKeys.communication.forItem(itemId) });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to update conversation status'),
  });
};

/**
 * Direct by-id fetch (Phase 6) — powers the Communication Center's
 * `?conversation=` deep-link preselect, which (unlike a normal row click)
 * has no list row to read context from yet. 404s (wrong vendor, or a driver
 * given a link to a conversation outside their own sheets) surface via
 * `isError`, handled by the caller.
 */
export const useConversation = (conversationId: string, enabled: boolean) => {
  return useQuery({
    queryKey: ['conversation-by-id', conversationId],
    queryFn: (): Promise<ConversationContext> => conversationsApi.getById(conversationId),
    enabled: enabled && !!conversationId,
    retry: false,
  });
};
