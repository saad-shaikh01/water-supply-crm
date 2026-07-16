'use client';

import Link from 'next/link';
import { Badge, Button, cn } from '@water-supply-crm/ui';
import { Calendar, CheckCircle2, ExternalLink, Loader2, Package, RotateCcw, Truck, User, XCircle } from 'lucide-react';
import type { ConversationContext } from '@water-supply-crm/types';
import { StatusBadge } from '../../../components/shared/status-badge';
import { useSetStatus } from '../hooks/use-conversations';
import { useCan } from '../../authz/hooks/use-can';

const CONVERSATION_STATUS_STYLES: Record<ConversationContext['status'], string> = {
  OPEN: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  RESOLVED: 'bg-blue-500/15 text-blue-700 dark:text-blue-400',
  CLOSED: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400',
};

const WAITING_ON_LABEL: Record<'DRIVER' | 'OFFICE', string> = {
  DRIVER: 'Waiting on Driver',
  OFFICE: 'Waiting on Office',
};

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });

interface ConversationHeaderProps {
  conversation: ConversationContext;
}

/**
 * Context block for the inbox detail pane. Status controls added Phase 5 —
 * gated by `conversations:manage_status` (office-only under the default role
 * presets — matches the backend's RequirePermissions check on PATCH .../status),
 * calling the Phase 1 status endpoint directly (transitions, the
 * CLOSED-can-only-reopen guard, and audit logging are all server-side,
 * unchanged here). "Open Delivery" deep link added Phase 6, §6.1.
 */
export function ConversationHeader({ conversation }: ConversationHeaderProps) {
  const setStatus = useSetStatus(conversation.id, conversation.item.id);
  const canManageStatus = useCan('conversations:manage_status');

  return (
    <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-border/40">
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-black truncate">{conversation.customer.name}</span>
          <Badge variant="outline" className="text-[9px] font-mono px-1.5">{conversation.customer.customerCode}</Badge>
          <Badge className={cn('text-[9px] px-1.5 border-0', CONVERSATION_STATUS_STYLES[conversation.status])}>
            {conversation.status}
          </Badge>
          {conversation.waitingOn && (
            <Badge variant="outline" className="text-[9px] px-1.5 font-medium">
              {WAITING_ON_LABEL[conversation.waitingOn]}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-3 flex-wrap mt-1.5 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            {formatDate(conversation.dailySheet.date)}
          </span>
          <span className="flex items-center gap-1">
            <Truck className="h-3 w-3" />
            {conversation.van.plateNumber}
          </span>
          <span className="flex items-center gap-1">
            <User className="h-3 w-3" />
            {conversation.driver.name}
          </span>
          <span className="flex items-center gap-1">
            <Package className="h-3 w-3" />
            Stop #{conversation.item.sequence} · {conversation.item.product.name}
          </span>
        </div>
      </div>

      <div className="flex flex-col items-end gap-2 shrink-0">
        <Link
          href={`/dashboard/daily-sheets/${conversation.dailySheet.id}?item=${conversation.item.id}`}
          className="flex items-center gap-1.5 text-[11px] font-bold text-primary hover:underline"
        >
          <ExternalLink className="h-3 w-3" />
          Open Delivery
        </Link>
        <StatusBadge status={conversation.item.status} />
        {canManageStatus && (
          <div className="flex items-center gap-1.5">
            {conversation.status === 'OPEN' && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-full font-bold text-[11px] h-7 px-2.5 gap-1"
                  disabled={setStatus.isPending}
                  onClick={() => setStatus.mutate('RESOLVED')}
                >
                  <CheckCircle2 className="h-3 w-3" />
                  Resolve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-full font-bold text-[11px] h-7 px-2.5 gap-1 text-muted-foreground"
                  disabled={setStatus.isPending}
                  onClick={() => setStatus.mutate('CLOSED')}
                >
                  <XCircle className="h-3 w-3" />
                  Close
                </Button>
              </>
            )}
            {conversation.status === 'RESOLVED' && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-full font-bold text-[11px] h-7 px-2.5 gap-1"
                  disabled={setStatus.isPending}
                  onClick={() => setStatus.mutate('OPEN')}
                >
                  <RotateCcw className="h-3 w-3" />
                  Reopen
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-full font-bold text-[11px] h-7 px-2.5 gap-1 text-muted-foreground"
                  disabled={setStatus.isPending}
                  onClick={() => setStatus.mutate('CLOSED')}
                >
                  <XCircle className="h-3 w-3" />
                  Close
                </Button>
              </>
            )}
            {conversation.status === 'CLOSED' && (
              <Button
                size="sm"
                variant="outline"
                className="rounded-full font-bold text-[11px] h-7 px-2.5 gap-1"
                disabled={setStatus.isPending}
                onClick={() => setStatus.mutate('OPEN')}
              >
                <RotateCcw className="h-3 w-3" />
                Reopen
              </Button>
            )}
            {setStatus.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          </div>
        )}
      </div>
    </div>
  );
}
