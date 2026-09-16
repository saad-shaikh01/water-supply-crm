'use client';

import { Skeleton } from '@water-supply-crm/ui';
import { useConversationForCustomer } from '../hooks/use-conversations';
import { ConversationThread } from './conversation-thread';

/**
 * Customer-list entry point (no delivery/item context on that page) — wraps
 * `ConversationThread` after resolving the customer's anchor item server-side
 * via getOrCreateForCustomer. A customer with no deliveries ever gets a
 * plain message instead of the thread.
 */
export function CustomerConversationThread({ customerId }: { customerId: string }) {
  const { data, isLoading, isError, error } = useConversationForCustomer(customerId, true);

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-16 w-2/3 rounded-2xl" />
        <Skeleton className="h-16 w-1/2 rounded-2xl ml-auto" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <p className="text-sm text-muted-foreground text-center py-6">
        {(error as any)?.response?.data?.message ?? 'This customer has no deliveries on record yet.'}
      </p>
    );
  }

  return (
    <ConversationThread
      itemId={data.itemId}
      sheetId={data.sheetId}
      variant="embedded"
      isDriver={false}
      itemIsPending={data.isItemPending}
      isClosed={data.isSheetClosed}
    />
  );
}
