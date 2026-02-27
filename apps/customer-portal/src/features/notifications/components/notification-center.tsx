'use client';

import { useRouter } from 'next/navigation';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  cn,
} from '@water-supply-crm/ui';
import { Bell, CheckCheck, CreditCard, MessageCircle, ShoppingCart } from 'lucide-react';
import { useNotifications, type PortalNotification } from '../hooks/use-notifications';

const SOURCE_ICON: Record<PortalNotification['source'], typeof Bell> = {
  PAYMENT: CreditCard,
  ORDER: ShoppingCart,
  TICKET: MessageCircle,
};

function formatNotificationDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Recently';

  return date.toLocaleDateString('en-PK', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function NotificationCenter() {
  const router = useRouter();
  const {
    notifications,
    unreadCount,
    isLoading,
    isError,
    refetch,
    markAsRead,
    markAllAsRead,
  } = useNotifications();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative text-muted-foreground h-9 w-9 rounded-full hover:bg-accent dark:hover:bg-white/5 transition-colors"
        >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-black flex items-center justify-center border-2 border-background">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        sideOffset={10}
        className="w-[22rem] rounded-2xl border-border/50 bg-background/95 backdrop-blur-xl p-0 shadow-2xl"
      >
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div>
            <p className="text-sm font-black tracking-tight">Notifications</p>
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {unreadCount} unread
            </p>
          </div>
          <button
            type="button"
            onClick={markAllAsRead}
            disabled={notifications.length === 0 || unreadCount === 0}
            className="inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-[11px] font-bold text-primary disabled:text-muted-foreground disabled:cursor-not-allowed"
          >
            <CheckCheck className="h-3.5 w-3.5" />
            Read All
          </button>
        </div>

        <DropdownMenuSeparator className="bg-border/50 m-0" />

        <div className="max-h-[24rem] overflow-y-auto p-2">
          {isLoading ? (
            <div className="space-y-2 p-2">
              {[1, 2, 3].map((item) => (
                <div key={item} className="h-16 rounded-2xl bg-accent/40 animate-pulse" />
              ))}
            </div>
          ) : isError ? (
            <button
              type="button"
              onClick={() => refetch()}
              className="w-full rounded-2xl border border-border/50 px-3 py-6 text-sm font-bold text-primary"
            >
              Failed to load notifications. Retry
            </button>
          ) : notifications.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/50 px-4 py-8 text-center">
              <p className="text-sm font-bold">No notifications yet</p>
              <p className="text-xs text-muted-foreground mt-1">
                Payment, order, and support updates will appear here.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {notifications.map((notification) => {
                const Icon = SOURCE_ICON[notification.source];

                return (
                  <button
                    type="button"
                    key={notification.id}
                    onClick={() => {
                      markAsRead(notification.id);
                      router.push(notification.href);
                    }}
                    className={cn(
                      'w-full rounded-2xl border px-3 py-3 text-left transition-colors',
                      notification.isRead
                        ? 'border-border/40 bg-background/40'
                        : 'border-primary/20 bg-primary/[0.04]'
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={cn(
                          'mt-0.5 h-9 w-9 rounded-xl flex items-center justify-center shrink-0',
                          notification.isRead
                            ? 'bg-muted text-muted-foreground'
                            : 'bg-primary/10 text-primary'
                        )}
                      >
                        <Icon className="h-4 w-4" />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-bold leading-tight">{notification.title}</p>
                          {!notification.isRead && (
                            <span className="mt-1 h-2 w-2 rounded-full bg-primary shrink-0" />
                          )}
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                          {notification.message}
                        </p>
                        <p className="mt-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                          {formatNotificationDate(notification.createdAt)}
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
