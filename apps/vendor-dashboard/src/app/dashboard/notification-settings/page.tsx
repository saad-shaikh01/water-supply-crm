'use client';

import {
  MessageCircle, Bell, Package, FileText, Wallet, ShoppingCart, LifeBuoy, Loader2, PackageX, AlertTriangle,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, cn } from '@water-supply-crm/ui';
import { PageHeader } from '../../../components/shared/page-header';
import {
  useNotificationSettings,
  useUpdateNotificationSetting,
} from '../../../features/notification-settings/hooks/use-notification-settings';
import type {
  NotificationChannel,
  NotificationType,
} from '../../../features/notification-settings/api/notification-settings.api';

/** Display metadata + which channels actually apply to each flow. */
const FLOWS: Record<
  NotificationType,
  { label: string; description: string; icon: typeof Package; channels: NotificationChannel[] }
> = {
  DELIVERY_RECEIPT: {
    label: 'Delivery Receipt',
    description: 'Sent to the customer when a delivery is completed (with PDF receipt).',
    icon: Package,
    channels: ['WHATSAPP', 'PUSH'],
  },
  MONTHLY_STATEMENT: {
    label: 'Monthly Statement & Balance Reminder',
    description: 'Statement PDF and balance reminders. WhatsApp only.',
    icon: FileText,
    channels: ['WHATSAPP'],
  },
  PAYMENT_RECEIVED: {
    label: 'Payment Confirmation',
    description: 'Sent when a payment is approved, recorded, or rejected.',
    icon: Wallet,
    channels: ['WHATSAPP', 'PUSH'],
  },
  ORDER_UPDATE: {
    label: 'Order Updates',
    description: 'Order approved, rejected, planned, and out-for-delivery updates.',
    icon: ShoppingCart,
    channels: ['WHATSAPP', 'PUSH'],
  },
  TICKET_REPLY: {
    label: 'Support Ticket Replies',
    description: 'Sent when you reply to or resolve a customer support ticket.',
    icon: LifeBuoy,
    channels: ['WHATSAPP', 'PUSH'],
  },
  DELIVERY_FAILED: {
    label: 'Unable to Deliver',
    description: 'Sent when a delivery could not be completed — includes the driver\'s photo evidence when one was captured.',
    icon: PackageX,
    channels: ['WHATSAPP', 'PUSH'],
  },
  PAYMENT_WARNING: {
    label: 'Overdue Balance Warning',
    description: 'Sent from Balance Reminders to customers who received a statement and still have an overdue balance. WhatsApp only.',
    icon: AlertTriangle,
    channels: ['WHATSAPP'],
  },
};

const FLOW_ORDER: NotificationType[] = [
  'DELIVERY_RECEIPT',
  'DELIVERY_FAILED',
  'MONTHLY_STATEMENT',
  'PAYMENT_WARNING',
  'PAYMENT_RECEIVED',
  'ORDER_UPDATE',
  'TICKET_REPLY',
];

function Toggle({
  enabled,
  onToggle,
  disabled,
  label,
}: {
  enabled: boolean;
  onToggle: () => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={label}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        enabled ? 'bg-emerald-500' : 'bg-input dark:bg-muted',
      )}
    >
      <span
        className={cn(
          'inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform',
          enabled ? 'translate-x-5' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}

const CHANNEL_META: Record<NotificationChannel, { label: string; icon: typeof Bell }> = {
  WHATSAPP: { label: 'WhatsApp', icon: MessageCircle },
  PUSH: { label: 'In-app Push', icon: Bell },
};

export default function NotificationSettingsPage() {
  const { data: rows, isLoading } = useNotificationSettings();
  const update = useUpdateNotificationSetting();

  const rowByType = new Map((rows ?? []).map((r) => [r.type, r]));

  return (
    <div>
      <PageHeader
        title="Notification Controls"
        description="Turn each notification flow on or off per channel. WhatsApp and in-app push are controlled independently, so disabling WhatsApp for a flow does not stop its in-app push."
      />

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading settings…
        </div>
      ) : (
        <div className="space-y-4">
          {FLOW_ORDER.map((type) => {
            const meta = FLOWS[type];
            const row = rowByType.get(type);
            const Icon = meta.icon;

            return (
              <Card key={type}>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    {meta.label}
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">{meta.description}</p>
                </CardHeader>
                <CardContent className="flex flex-col gap-3 sm:flex-row sm:gap-8">
                  {(['WHATSAPP', 'PUSH'] as NotificationChannel[]).map((channel) => {
                    const applies = meta.channels.includes(channel);
                    const enabled = row?.channels?.[channel] ?? true;
                    const ChannelIcon = CHANNEL_META[channel].icon;

                    return (
                      <div key={channel} className="flex items-center gap-3">
                        <ChannelIcon className="h-4 w-4 text-muted-foreground" />
                        <span className="w-24 text-sm font-medium">
                          {CHANNEL_META[channel].label}
                        </span>
                        {applies ? (
                          <Toggle
                            enabled={enabled}
                            disabled={update.isPending}
                            label={`${meta.label} on ${CHANNEL_META[channel].label}`}
                            onToggle={() =>
                              update.mutate({ type, channel, enabled: !enabled })
                            }
                          />
                        ) : (
                          <span className="text-xs text-muted-foreground">Not applicable</span>
                        )}
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
