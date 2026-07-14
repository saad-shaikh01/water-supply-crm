'use client';

import { Suspense, useEffect, useState } from 'react';
import { useQueryState, parseAsString, parseAsInteger } from 'nuqs';
import { toast } from 'sonner';
import { Button, cn } from '@water-supply-crm/ui';
import { ArrowLeft, Inbox } from 'lucide-react';
import { PageHeader } from '../../../components/shared/page-header';
import { ConversationFilters } from '../../../features/communication/components/conversation-filters';
import { ConversationList } from '../../../features/communication/components/conversation-list';
import { ConversationHeader } from '../../../features/communication/components/conversation-header';
import { ConversationThread } from '../../../features/communication/components/conversation-thread';
import { useConversation, useInbox } from '../../../features/communication/hooks/use-conversations';
import { useAuthStore } from '../../../store/auth.store';
import type { ConversationListItem } from '../../../features/communication/api/conversations.api';

const PAGE_LIMIT = 20;

function CommunicationsContent() {
  const user = useAuthStore((s) => s.user);
  const isDriver = user?.role === 'DRIVER';

  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1));
  const [status, setStatus] = useQueryState('status', parseAsString.withDefault('all'));
  const [waitingOn, setWaitingOn] = useQueryState('waitingOn', parseAsString.withDefault('all'));
  const [search] = useQueryState('search', parseAsString.withDefault(''));
  const [vanId] = useQueryState('vanId', parseAsString.withDefault(''));
  const [driverId] = useQueryState('driverId', parseAsString.withDefault(''));
  const [from] = useQueryState('from', parseAsString.withDefault(''));
  const [to] = useQueryState('to', parseAsString.withDefault(''));

  const [selected, setSelected] = useState<ConversationListItem | null>(null);

  // Reverse deep link (Phase 6, §6.1): the Daily Sheet card's "Open in
  // Communications" link lands here with `?conversation=:id`. findOne is
  // filter-independent — it resolves regardless of the current status/
  // van/driver/search filters, matching the doc's "inbox preselects" wording
  // (select it in the detail pane; the list panel's own filtered view is
  // untouched).
  const [conversationParam, setConversationParam] = useQueryState('conversation', parseAsString.withDefault(''));
  const conversationQuery = useConversation(conversationParam, !!conversationParam);
  useEffect(() => {
    if (!conversationParam) return;
    if (conversationQuery.data) {
      setSelected({ ...conversationQuery.data, unreadCount: 0 });
      setConversationParam(null);
    } else if (conversationQuery.isError) {
      toast.error('Conversation not found');
      setConversationParam(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationParam, conversationQuery.data, conversationQuery.isError]);

  const { data, isLoading } = useInbox({
    page,
    limit: PAGE_LIMIT,
    status: status !== 'all' ? (status as 'OPEN' | 'RESOLVED' | 'CLOSED') : undefined,
    waitingOn: waitingOn !== 'all' ? (waitingOn as 'DRIVER' | 'OFFICE') : undefined,
    search: search || undefined,
    vanId: !isDriver && vanId ? vanId : undefined,
    driverId: !isDriver && driverId ? driverId : undefined,
    dateFrom: from || undefined,
    dateTo: to || undefined,
  });

  const conversations = data?.data ?? [];
  const totalPages = data?.meta.totalPages ?? 1;

  // `selected` is a snapshot from the list, not a live subscription — a
  // status change (Phase 5) refetches the inbox, and without this the
  // header would keep showing the pre-mutation status/waitingOn until the
  // user re-picks the row. Re-sync to the fresh row whenever one is present
  // in the current page; if the mutation filtered the row out of view
  // entirely (e.g. resolving while the Open filter is active), the last
  // known snapshot is kept rather than clearing the selection outright.
  useEffect(() => {
    if (!selected) return;
    const fresh = conversations.find((c) => c.id === selected.id);
    if (fresh && fresh !== selected) setSelected(fresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations]);

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Communications"
        description="Delivery conversations between drivers and the office."
      />

      <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[360px_1fr] rounded-2xl border border-border/50 bg-card/30 overflow-hidden h-[calc(100vh-260px)] sm:h-[calc(100vh-240px)]">
        {/* List pane */}
        <div className={cn('flex flex-col border-border/40 md:border-r min-h-0', selected && 'hidden md:flex')}>
          <ConversationFilters
            status={status}
            onStatusChange={(v) => { setStatus(v); setPage(1); }}
            waitingOn={waitingOn}
            onWaitingOnChange={(v) => { setWaitingOn(v); setPage(1); }}
            isDriver={isDriver}
            onBeforeChange={() => setPage(1)}
          />
          <div className="flex-1 overflow-y-auto min-h-0">
            <ConversationList
              conversations={conversations}
              selectedId={selected?.id ?? null}
              onSelect={setSelected}
              isLoading={isLoading}
            />
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-t border-border/40">
              <Button
                size="sm"
                variant="outline"
                className="rounded-full font-bold text-xs h-8"
                disabled={page <= 1}
                onClick={() => setPage(Math.max(1, page - 1))}
              >
                Prev
              </Button>
              <span className="text-[10px] text-muted-foreground font-medium">
                Page {page} of {totalPages}
              </span>
              <Button
                size="sm"
                variant="outline"
                className="rounded-full font-bold text-xs h-8"
                disabled={page >= totalPages}
                onClick={() => setPage(Math.min(totalPages, page + 1))}
              >
                Next
              </Button>
            </div>
          )}
        </div>

        {/* Detail pane */}
        <div className={cn('flex flex-col min-h-0', !selected && 'hidden md:flex')}>
          {selected ? (
            <>
              <div className="flex items-center gap-2 md:hidden px-2 py-2 border-b border-border/40">
                <Button
                  size="sm"
                  variant="ghost"
                  className="rounded-full font-bold gap-1.5 text-xs"
                  onClick={() => setSelected(null)}
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Back to list
                </Button>
              </div>
              <ConversationHeader conversation={selected} isDriver={isDriver} />
              <div className="flex-1 min-h-0 p-3">
                <ConversationThread
                  itemId={selected.item.id}
                  sheetId={selected.dailySheet.id}
                  variant="inbox"
                  isDriver={isDriver}
                  itemIsPending={selected.item.status === 'PENDING'}
                  isClosed={selected.dailySheet.isClosed}
                />
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center p-8">
              <Inbox className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm font-bold text-muted-foreground">Select a conversation</p>
              <p className="text-xs text-muted-foreground/70 max-w-xs">
                Pick a delivery conversation from the list to view messages.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function CommunicationsPage() {
  return (
    <Suspense fallback={<div className="h-64 rounded-2xl bg-accent/30 animate-pulse" />}>
      <CommunicationsContent />
    </Suspense>
  );
}
