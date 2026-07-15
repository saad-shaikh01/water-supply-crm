import { apiClient } from '@water-supply-crm/data-access';
import type { ConversationContext, ConversationMessage } from '@water-supply-crm/types';

export interface MessagesPage {
  messages: ConversationMessage[];
  nextCursor: string | null;
}

export type ConversationStatusValue = 'OPEN' | 'RESOLVED' | 'CLOSED';

export interface InboxQuery {
  page?: number;
  limit?: number;
  status?: ConversationStatusValue;
  waitingOn?: 'DRIVER' | 'OFFICE';
  vanId?: string;
  driverId?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
}

// Inbox rows carry unreadCount (list-only — the detail/get-or-create fetches
// don't compute it); ConversationContext itself stays the plain shape.
export interface ConversationListItem extends ConversationContext {
  unreadCount: number;
}

export interface InboxResponse {
  data: ConversationListItem[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

// Customer Communication Center — Phase 2 built the embedded-thread surface,
// Phase 3 the inbox list, Phase 4 read-state, Phase 5 the status endpoint.
// Phase 6 adds getById — the conversationId-direct entry point deferred
// since Phase 2 (nothing needed it until the Communications page had to
// preselect a row from a `?conversation=` deep link rather than a click).
export const conversationsApi = {
  getOrCreateForItem: (itemId: string) =>
    apiClient.put<ConversationContext>(`/conversations/for-item/${itemId}`).then((r) => r.data),

  findMany: (query: InboxQuery) =>
    apiClient.get<InboxResponse>('/conversations', { params: query }).then((r) => r.data),

  getById: (conversationId: string) =>
    apiClient.get<ConversationContext>(`/conversations/${conversationId}`).then((r) => r.data),

  setStatus: (conversationId: string, status: ConversationStatusValue) =>
    apiClient
      .patch<ConversationContext>(`/conversations/${conversationId}/status`, { status })
      .then((r) => r.data),

  markRead: (conversationId: string) =>
    apiClient
      .patch<{ success: boolean; lastReadAt: string }>(`/conversations/${conversationId}/read`, {})
      .then((r) => r.data),

  getUnreadCount: () =>
    apiClient.get<{ count: number }>('/conversations/unread-count').then((r) => r.data),

  getMessages: (conversationId: string, before?: string) =>
    apiClient
      .get<MessagesPage>(`/conversations/${conversationId}/messages`, {
        params: before ? { before } : undefined,
      })
      .then((r) => r.data),

  sendText: (conversationId: string, data: { text: string; requiresAck?: boolean }) =>
    apiClient
      .post<ConversationMessage>(`/conversations/${conversationId}/messages`, data)
      .then((r) => r.data),

  sendVoice: (
    conversationId: string,
    formData: FormData,
    opts?: { duration?: number; requiresAck?: boolean },
  ) => {
    const params = new URLSearchParams();
    if (opts?.duration != null) params.set('duration', String(opts.duration));
    if (opts?.requiresAck) params.set('requiresAck', 'true');
    const qs = params.toString();
    return apiClient
      .post<ConversationMessage>(
        `/conversations/${conversationId}/messages/voice${qs ? `?${qs}` : ''}`,
        formData,
        // Unset the instance-level 'application/json' default so the browser
        // sets multipart/form-data with the correct boundary automatically.
        { headers: { 'Content-Type': undefined } },
      )
      .then((r) => r.data);
  },

  acknowledgeMessage: (messageId: string) =>
    apiClient
      .patch<ConversationMessage>(`/messages/${messageId}/acknowledge`, {})
      .then((r) => r.data),

  getMessageAudioUrl: (messageId: string) =>
    apiClient.get<{ signedUrl: string }>(`/messages/${messageId}/audio`).then((r) => r.data),
};
