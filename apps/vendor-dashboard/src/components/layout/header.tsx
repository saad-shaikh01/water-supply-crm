'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck, Loader2, Menu, Search } from 'lucide-react';
import { UserNav } from './user-nav';
import { Sidebar } from './sidebar';
import { ThemeToggle } from './theme-toggle';
import { apiClient } from '@water-supply-crm/data-access';
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@water-supply-crm/ui';
import { useAuthStore } from '../../store/auth.store';
import { syncVendorSessionFcmToken } from '../../features/auth/hooks/use-auth';

interface InAppNotification {
  id: string;
  type: string;
  title: string;
  message: string;
  entityId?: string;
  isRead: boolean;
  createdAt: string;
}

export function Header() {
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  const {
    data: notificationsResponse,
    isLoading: isNotificationsLoading,
    isError: isNotificationsError,
    refetch: refetchNotifications,
  } = useQuery({
    queryKey: ['vendor-notifications', user?.id],
    queryFn: () => apiClient.get('/portal/notifications', { params: { page: 1, limit: 8 } }).then((response) => response.data),
    enabled: !!user?.id,
    staleTime: 30_000,
  });

  const {
    data: unreadResponse,
    isLoading: isUnreadLoading,
    isError: isUnreadError,
    refetch: refetchUnreadCount,
  } = useQuery({
    queryKey: ['vendor-notifications-unread', user?.id],
    queryFn: () => apiClient.get('/portal/notifications/unread-count').then((response) => response.data),
    enabled: !!user?.id,
    staleTime: 30_000,
  });

  const { mutate: markAllRead, isPending: isMarkingAllRead } = useMutation({
    mutationFn: () => apiClient.patch('/portal/notifications/read-all'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendor-notifications'] });
      queryClient.invalidateQueries({ queryKey: ['vendor-notifications-unread'] });
    },
  });

  const { mutate: markNotificationRead } = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/portal/notifications/${id}/read`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendor-notifications'] });
      queryClient.invalidateQueries({ queryKey: ['vendor-notifications-unread'] });
    },
  });

  useEffect(() => {
    if (!user?.id) return;

    const syncToken = () => {
      void syncVendorSessionFcmToken();
    };

    syncToken();
    window.addEventListener('focus', syncToken);

    return () => {
      window.removeEventListener('focus', syncToken);
    };
  }, [user?.id]);

  const notifications = useMemo(
    () => ((notificationsResponse as { data?: InAppNotification[] } | undefined)?.data ?? []),
    [notificationsResponse]
  );
  const unreadCount = (unreadResponse as { count?: number } | undefined)?.count ?? 0;
  const hasUnread = unreadCount > 0;

  const formatTimestamp = (value: string) =>
    new Date(value).toLocaleString(undefined, {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });

  return (
    <header className="h-20 bg-white/[0.02] backdrop-blur-3xl flex items-center justify-between px-6 md:px-12 sticky top-0 z-40 shrink-0 border-b border-border shadow-2xl">
      <div className="flex items-center gap-8 flex-1">
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="md:hidden hover:bg-white/5 rounded-xl h-12 w-12 border border-border">
              <Menu className="h-6 w-6 text-white" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="p-0 w-80 border-r border-border bg-transparent">
            <Sidebar className="w-full h-full border-none shadow-none" />
          </SheetContent>
        </Sheet>

        <div className="hidden md:flex items-center gap-4 px-6 py-2.5 rounded-xl bg-white/[0.03] border border-border max-w-md w-full focus-within:border-primary/50 focus-within:ring-4 focus-within:ring-primary/10 transition-colors shadow-xl">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input 
            type="text" 
            placeholder="Search anything..." 
            className="bg-transparent border-none outline-none text-sm w-full placeholder:text-muted-foreground/50 font-medium tracking-tight text-white"
          />
          <kbd className="hidden lg:inline-flex h-5 select-none items-center gap-1 rounded border border-border bg-white/5 px-1.5 font-mono text-[10px] text-muted-foreground">
            <span className="text-xs">⌘</span>K
          </kbd>
        </div>
      </div>

      <div className="flex items-center gap-4 md:gap-6">
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <DropdownMenu
            open={notificationsOpen}
            onOpenChange={(open) => {
              setNotificationsOpen(open);
              if (open && user?.id) {
                void refetchNotifications();
                void refetchUnreadCount();
              }
            }}
          >
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Open notifications"
                className="relative text-muted-foreground hover:text-white hover:bg-white/5 rounded-xl h-11 w-11 transition-colors border border-transparent hover:border-border data-[state=open]:bg-white/5 data-[state=open]:text-white data-[state=open]:border-border"
              >
                <Bell className="h-5 w-5" />
                {hasUnread && (
                  <span className="absolute -top-1 -right-1 min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-primary text-primary-foreground text-[9px] font-black flex items-center justify-center shadow-[0_0_10px_rgba(99,102,241,1)]">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-80 p-0 bg-background/95 backdrop-blur-xl border-border/50 rounded-2xl shadow-2xl"
            >
              <div className="px-4 py-3 border-b border-border/50 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-white">Notifications</p>
                  <p className="text-[11px] text-muted-foreground">
                    {isUnreadLoading
                      ? 'Loading...'
                      : isUnreadError
                        ? 'Unable to load unread count'
                        : hasUnread
                          ? `${unreadCount} unread`
                          : 'No unread notifications'}
                  </p>
                </div>
                {hasUnread && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => markAllRead()}
                    disabled={isMarkingAllRead}
                    className="rounded-xl h-8 px-2.5 text-[11px] font-semibold"
                  >
                    {isMarkingAllRead ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCheck className="h-3.5 w-3.5" />}
                  </Button>
                )}
              </div>
              <div className="max-h-96 overflow-y-auto">
                {isNotificationsLoading ? (
                  <div className="px-4 py-8 flex items-center justify-center text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                  </div>
                ) : isNotificationsError ? (
                  <div className="px-4 py-6">
                    <p className="text-sm font-medium text-foreground">Unable to load notifications.</p>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Try opening the menu again in a moment.
                    </p>
                  </div>
                ) : notifications.length === 0 ? (
                  <div className="px-4 py-6">
                    <p className="text-sm font-medium text-foreground">No notifications yet.</p>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      New alerts will appear here when they are available.
                    </p>
                  </div>
                ) : (
                  <div className="py-1.5">
                    {notifications.map((notification) => (
                      <button
                        key={notification.id}
                        type="button"
                        onClick={() => {
                          if (!notification.isRead) {
                            markNotificationRead(notification.id);
                          }
                        }}
                        className="w-full text-left px-4 py-3 hover:bg-white/5 transition-colors border-b border-border/30 last:border-b-0"
                      >
                        <div className="flex items-start gap-3">
                          <span
                            className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${notification.isRead ? 'bg-border' : 'bg-primary shadow-[0_0_10px_rgba(99,102,241,0.9)]'}`}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-3">
                              <p className="text-sm font-semibold text-white truncate">{notification.title}</p>
                              <span className="text-[10px] text-muted-foreground shrink-0">
                                {formatTimestamp(notification.createdAt)}
                              </span>
                            </div>
                            <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
                              {notification.message}
                            </p>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="h-8 w-px bg-border/50 mx-2 hidden sm:block" />
        <UserNav />
      </div>
    </header>
  );
}
